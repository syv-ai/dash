import { execFile } from 'child_process';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import type {
  FileChange,
  FileChangeStatus,
  GitStatus,
  DiffResult,
  DiffHunk,
  DiffLine,
  BranchInfo,
  CommitNode,
  CommitRef,
  GraphCommit,
  GraphConnection,
  CommitGraphData,
  CommitDetail,
} from '@shared/types';

const execFileAsync = promisify(execFile);

const MAX_DIFF_SIZE = 1024 * 1024; // 1MB max diff output
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: MAX_DIFF_SIZE * 2,
    timeout: 15000,
  });
  return stdout;
}

export class GitService {
  /**
   * Fetch from remote and list remote branches sorted by most recent commit.
   */
  static async fetchAndListBranches(cwd: string): Promise<BranchInfo[]> {
    // Fetch with prune to sync with remote (30s timeout)
    try {
      await execFileAsync('git', ['fetch', '--prune', 'origin'], {
        cwd,
        timeout: 30000,
      });
    } catch (err: unknown) {
      const msg = String((err as { stderr?: string }).stderr || err);
      if (/does not appear to be a git repository/i.test(msg)) {
        throw new Error('No remote named "origin" found. Add a remote or disable worktree mode.');
      } else if (/could not read from remote repository/i.test(msg)) {
        throw new Error(
          'Could not connect to remote repository. Check your network connection and SSH/HTTPS credentials.',
        );
      } else if (/authentication failed/i.test(msg) || /could not resolve host/i.test(msg)) {
        throw new Error(
          'Authentication failed or host not reachable. Check your credentials and network.',
        );
      } else if (/not a git repository/i.test(msg)) {
        throw new Error('This directory is not a git repository.');
      } else if (/timed out/i.test(msg) || (err as { killed?: boolean }).killed) {
        throw new Error('Fetch timed out. Check your network connection and try again.');
      } else {
        // Extract just the "fatal:" line from stderr for a cleaner message
        const fatalMatch = msg.match(/fatal:\s*(.+)/i);
        throw new Error(
          fatalMatch
            ? `Git fetch failed: ${fatalMatch[1].trim()}`
            : `Git fetch failed: ${msg.split('\n')[0].trim()}`,
        );
      }
    }

    // List remote branches sorted by committerdate descending
    const { stdout } = await execFileAsync(
      'git',
      [
        'branch',
        '-r',
        '--format=%(refname:short)\t%(objectname:short)\t%(committerdate:relative)',
        '--sort=-committerdate',
      ],
      { cwd, timeout: 15000 },
    );

    const branches: BranchInfo[] = [];
    for (const line of stdout.split('\n').filter(Boolean)) {
      const [ref, shortHash, ...dateParts] = line.split('\t');
      if (!ref || ref === 'origin/HEAD') continue;
      const name = ref.replace(/^origin\//, '');
      branches.push({
        name,
        ref,
        shortHash: shortHash || '',
        relativeDate: dateParts.join('\t') || '',
      });
    }

    return branches;
  }

  /**
   * Get full git status for a working directory.
   */
  static async getStatus(cwd: string): Promise<GitStatus> {
    const branch = await this.getBranch(cwd);
    const { ahead, behind } = await this.getAheadBehind(cwd);
    const files = await this.getFileChanges(cwd);
    return { branch, ahead, behind, files };
  }

  /**
   * Get current branch name.
   */
  static async getBranch(cwd: string): Promise<string | null> {
    try {
      const out = await git(cwd, ['branch', '--show-current']);
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Get ahead/behind counts relative to upstream.
   */
  static async getAheadBehind(cwd: string): Promise<{ ahead: number; behind: number }> {
    try {
      const out = await git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
      const parts = out.trim().split(/\s+/);
      return {
        behind: parseInt(parts[0], 10) || 0,
        ahead: parseInt(parts[1], 10) || 0,
      };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  /**
   * Get list of changed files with their status and stat counts.
   */
  static async getFileChanges(cwd: string): Promise<FileChange[]> {
    const files: FileChange[] = [];

    // Get staged + unstaged changes via porcelain v2
    try {
      const out = await git(cwd, ['status', '--porcelain=v2', '--untracked-files=normal']);
      const lines = out.split('\n').filter(Boolean);

      for (const line of lines) {
        if (line.startsWith('1 ') || line.startsWith('2 ')) {
          // Changed entry (1 = ordinary, 2 = rename)
          const parts = line.split(' ');
          const xy = parts[1]; // XY status codes
          const isRename = line.startsWith('2 ');

          let filePath: string;
          let oldPath: string | undefined;

          if (isRename) {
            // Format: 2 XY sub mH mI mW hH hI score path\torigPath
            const rest = parts.slice(8).join(' ');
            const tabIdx = rest.indexOf('\t');
            filePath = rest.substring(tabIdx + 1);
            oldPath = rest.substring(0, tabIdx);
          } else {
            // Format: 1 XY sub mH mI mW hH hI path
            filePath = parts.slice(8).join(' ');
          }

          const x = xy[0]; // Index (staged) status
          const y = xy[1]; // Working tree status

          // If staged (X is not '.' and not '?')
          if (x !== '.' && x !== '?') {
            files.push({
              path: filePath,
              status: this.parseStatusChar(x),
              staged: true,
              additions: 0,
              deletions: 0,
              oldPath: isRename ? oldPath : undefined,
            });
          }

          // If unstaged (Y is not '.' and not '?')
          if (y !== '.' && y !== '?') {
            files.push({
              path: filePath,
              status: this.parseStatusChar(y),
              staged: false,
              additions: 0,
              deletions: 0,
            });
          }
        } else if (line.startsWith('? ')) {
          // Untracked file
          const filePath = line.substring(2);
          files.push({
            path: filePath,
            status: 'untracked',
            staged: false,
            additions: 0,
            deletions: 0,
          });
        } else if (line.startsWith('u ')) {
          // Unmerged (conflicted)
          const parts = line.split(' ');
          const filePath = parts.slice(10).join(' ');
          files.push({
            path: filePath,
            status: 'conflicted',
            staged: false,
            additions: 0,
            deletions: 0,
          });
        }
      }
    } catch {
      // Not a git repo or git error
      return [];
    }

    // Filter out Dash-managed hook files (not user content).
    // Git may report individual files or the whole .claude/ directory
    // (when untracked with --untracked-files=normal).
    const dashManagedFiles = new Set([
      '.claude/',
      '.claude/settings.local.json',
      '.claude/task-context.json',
    ]);
    const filtered = files.filter((f) => !dashManagedFiles.has(f.path));

    // Get numstat for addition/deletion counts
    await this.enrichWithNumstat(cwd, filtered);

    return filtered;
  }

  /**
   * Enrich file changes with addition/deletion line counts.
   */
  private static async enrichWithNumstat(cwd: string, files: FileChange[]): Promise<void> {
    // Staged numstat
    try {
      const stagedOut = await git(cwd, ['diff', '--cached', '--numstat']);
      this.applyNumstat(stagedOut, files, true);
    } catch {
      /* empty */
    }

    // Unstaged numstat
    try {
      const unstagedOut = await git(cwd, ['diff', '--numstat']);
      this.applyNumstat(unstagedOut, files, false);
    } catch {
      /* empty */
    }
  }

  private static applyNumstat(output: string, files: FileChange[], staged: boolean): void {
    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const filePath = parts[2];
      const match = files.find((f) => f.path === filePath && f.staged === staged);
      if (match) {
        match.additions = additions;
        match.deletions = deletions;
      }
    }
  }

  /**
   * Get unified diff for a specific file (or all files).
   */
  static async getDiff(
    cwd: string,
    filePath?: string,
    staged?: boolean,
    contextLines?: number,
  ): Promise<DiffResult> {
    const ctx = contextLines ?? 999999;
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push(`--unified=${ctx}`);
    if (filePath) args.push('--', filePath);

    try {
      const out = await git(cwd, args);
      return this.parseDiff(out, filePath || '(all)');
    } catch {
      return {
        filePath: filePath || '(all)',
        hunks: [],
        isBinary: false,
        additions: 0,
        deletions: 0,
      };
    }
  }

  /**
   * Get diff for an untracked file (show full contents as additions).
   */
  static async getDiffUntracked(
    cwd: string,
    filePath: string,
    contextLines?: number,
  ): Promise<DiffResult> {
    const ctx = contextLines ?? 999999;
    try {
      const out = await git(cwd, [
        'diff',
        '--no-index',
        `--unified=${ctx}`,
        '--',
        NULL_DEVICE,
        filePath,
      ]);
      return this.parseDiff(out, filePath);
    } catch (err: unknown) {
      // git diff --no-index returns exit code 1 when files differ (which is expected)
      const error = err as { stdout?: string; code?: number };
      if (error.stdout) {
        return this.parseDiff(error.stdout, filePath);
      }
      return { filePath, hunks: [], isBinary: false, additions: 0, deletions: 0 };
    }
  }

  /**
   * Stage a file.
   */
  static async stageFile(cwd: string, filePath: string): Promise<void> {
    await git(cwd, ['add', '--', filePath]);
  }

  /**
   * Stage all files.
   */
  static async stageAll(cwd: string): Promise<void> {
    await git(cwd, ['add', '-A']);
  }

  /**
   * Unstage a file.
   */
  static async unstageFile(cwd: string, filePath: string): Promise<void> {
    await git(cwd, ['reset', 'HEAD', '--', filePath]);
  }

  /**
   * Unstage all files.
   */
  static async unstageAll(cwd: string): Promise<void> {
    await git(cwd, ['reset', 'HEAD']);
  }

  /**
   * Discard changes to a file (restore from HEAD).
   */
  static async discardFile(cwd: string, filePath: string): Promise<void> {
    // First check if it's untracked
    const out = await git(cwd, ['status', '--porcelain', '--', filePath]);
    if (out.trimStart().startsWith('??')) {
      // Untracked — remove it
      unlinkSync(join(cwd, filePath));
    } else {
      await git(cwd, ['checkout', 'HEAD', '--', filePath]);
    }
  }

  /**
   * Commit staged changes.
   */
  static async commit(cwd: string, message: string): Promise<void> {
    await git(cwd, ['commit', '-m', message]);
  }

  /**
   * Push to remote.
   */
  static async push(cwd: string): Promise<void> {
    await git(cwd, ['push']);
  }

  // ── Commit Graph ────────────────────────────────────────

  static async getCommitGraph(cwd: string, limit = 150, skip = 0): Promise<CommitGraphData> {
    const args = [
      'log',
      '--exclude=refs/heads/_reserve/*',
      '--all',
      '--topo-order',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      '--format=%H%x00%h%x00%P%x00%an%x00%at%x00%s%x00%D',
    ];

    let output: string;
    try {
      output = await git(cwd, args);
    } catch {
      return { commits: [], totalCount: 0, maxLanes: 0 };
    }

    const lines = output.split('\n').filter(Boolean);
    const commits: CommitNode[] = lines.map((line) => {
      const parts = line.split('\0');
      return {
        hash: parts[0],
        shortHash: parts[1],
        parents: parts[2] ? parts[2].split(' ') : [],
        authorName: parts[3],
        authorDate: parseInt(parts[4], 10) || 0,
        subject: parts[5],
        refs: this.parseRefs(parts[6] || ''),
      };
    });

    const graphCommits = this.assignLanes(commits);

    // Get total count for pagination
    let totalCount = commits.length + skip;
    if (commits.length === limit) {
      try {
        const countOut = await git(cwd, ['rev-list', '--all', '--count']);
        totalCount = parseInt(countOut.trim(), 10) || totalCount;
      } catch {
        // keep estimate
      }
    }

    const maxLanes = graphCommits.reduce((max, gc) => Math.max(max, gc.lane + 1), 0);
    return { commits: graphCommits, totalCount, maxLanes };
  }

  static async getCommitDetail(cwd: string, hash: string): Promise<CommitDetail> {
    const format = '%H%x00%h%x00%P%x00%an%x00%at%x00%s%x00%D';
    const out = await git(cwd, ['log', '-1', `--format=${format}`, hash]);
    const parts = out.trim().split('\0');
    const commit: CommitNode = {
      hash: parts[0],
      shortHash: parts[1],
      parents: parts[2] ? parts[2].split(' ') : [],
      authorName: parts[3],
      authorDate: parseInt(parts[4], 10) || 0,
      subject: parts[5],
      refs: this.parseRefs(parts[6] || ''),
    };

    // Get body
    let body = '';
    try {
      body = (await git(cwd, ['log', '-1', '--format=%b', hash])).trim();
    } catch {
      // no body
    }

    // Get stats
    let additions = 0;
    let deletions = 0;
    let filesChanged = 0;
    try {
      const statOut = await git(cwd, ['diff', '--shortstat', `${hash}~1`, hash]);
      const match = statOut.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      );
      if (match) {
        filesChanged = parseInt(match[1], 10) || 0;
        additions = parseInt(match[2], 10) || 0;
        deletions = parseInt(match[3], 10) || 0;
      }
    } catch {
      // root commit or error
    }

    return { commit, body, stats: { additions, deletions, filesChanged } };
  }

  private static parseRefs(refStr: string): CommitRef[] {
    if (!refStr.trim()) return [];
    return refStr
      .split(',')
      .map((r) => {
        const trimmed = r.trim();
        if (trimmed.startsWith('HEAD -> ')) {
          return { name: trimmed.replace('HEAD -> ', ''), type: 'head' as const };
        }
        if (trimmed === 'HEAD') {
          return { name: 'HEAD', type: 'head' as const };
        }
        if (trimmed.startsWith('tag: ')) {
          return { name: trimmed.replace('tag: ', ''), type: 'tag' as const };
        }
        if (trimmed.includes('/')) {
          return { name: trimmed, type: 'remote' as const };
        }
        return { name: trimmed, type: 'local' as const };
      })
      .filter((r) => !r.name.includes('_reserve/') && r.name !== 'origin/HEAD');
  }

  private static assignLanes(commits: CommitNode[]): GraphCommit[] {
    const result: GraphCommit[] = [];
    // Maps commit hash → { column, color }
    const activeLanes = new Map<string, { column: number; color: number }>();
    const freeColumns: number[] = [];
    let nextColumn = 0;
    let nextColor = 0;

    // Build a map from hash → row index for connection endpoints
    const rowIndex = new Map<string, number>();
    for (let i = 0; i < commits.length; i++) {
      rowIndex.set(commits[i].hash, i);
    }

    for (let row = 0; row < commits.length; row++) {
      const commit = commits[row];
      const connections: GraphConnection[] = [];

      // Determine this commit's lane
      let lane: { column: number; color: number };
      if (activeLanes.has(commit.hash)) {
        lane = activeLanes.get(commit.hash)!;
        activeLanes.delete(commit.hash);
      } else {
        const col = freeColumns.length > 0 ? freeColumns.shift()! : nextColumn++;
        lane = { column: col, color: nextColor++ % 8 };
      }

      // Process parents
      for (let pi = 0; pi < commit.parents.length; pi++) {
        const parentHash = commit.parents[pi];
        const parentRow = rowIndex.get(parentHash);

        if (activeLanes.has(parentHash)) {
          // Parent already has a lane — draw merge line to it
          const parentLane = activeLanes.get(parentHash)!;
          connections.push({
            fromColumn: lane.column,
            toColumn: parentLane.column,
            fromRow: row,
            toRow: parentRow ?? row + 1,
            color: pi === 0 ? lane.color : parentLane.color,
            type: pi === 0 ? 'straight' : 'merge-in',
          });
        } else if (parentRow !== undefined) {
          // Parent is in our commit list — assign lane
          if (pi === 0) {
            // First parent inherits this commit's lane
            activeLanes.set(parentHash, { column: lane.column, color: lane.color });
            connections.push({
              fromColumn: lane.column,
              toColumn: lane.column,
              fromRow: row,
              toRow: parentRow,
              color: lane.color,
              type: 'straight',
            });
          } else {
            // Additional parents get new lane
            const col = freeColumns.length > 0 ? freeColumns.shift()! : nextColumn++;
            const color = nextColor++ % 8;
            activeLanes.set(parentHash, { column: col, color });
            connections.push({
              fromColumn: lane.column,
              toColumn: col,
              fromRow: row,
              toRow: parentRow,
              color,
              type: 'merge-out',
            });
          }
        }
      }

      // If this commit has no parents continuing, free the column
      if (commit.parents.length === 0 || !commit.parents.some((p) => rowIndex.has(p))) {
        // Only free if no parent will reuse it
        const columnStillActive = [...activeLanes.values()].some((l) => l.column === lane.column);
        if (!columnStillActive) {
          freeColumns.push(lane.column);
        }
      }

      result.push({
        commit,
        lane: lane.column,
        laneColor: lane.color,
        connections,
      });
    }

    return result;
  }

  // ── Diff Parsing ─────────────────────────────────────────

  private static parseDiff(raw: string, filePath: string): DiffResult {
    if (raw.includes('Binary files') || raw.includes('GIT binary patch')) {
      return { filePath, hunks: [], isBinary: true, additions: 0, deletions: 0 };
    }

    const hunks: DiffHunk[] = [];
    let totalAdd = 0;
    let totalDel = 0;

    // Split into hunks by @@ markers
    const hunkRegex = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/;
    const lines = raw.split('\n');
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      const hunkMatch = line.match(hunkRegex);
      if (hunkMatch) {
        currentHunk = {
          header: line,
          lines: [],
        };
        hunks.push(currentHunk);
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+')) {
        const diffLine: DiffLine = {
          type: 'add',
          content: line.substring(1),
          oldLineNumber: null,
          newLineNumber: newLine++,
        };
        currentHunk.lines.push(diffLine);
        totalAdd++;
      } else if (line.startsWith('-')) {
        const diffLine: DiffLine = {
          type: 'delete',
          content: line.substring(1),
          oldLineNumber: oldLine++,
          newLineNumber: null,
        };
        currentHunk.lines.push(diffLine);
        totalDel++;
      } else if (line.startsWith(' ')) {
        const diffLine: DiffLine = {
          type: 'context',
          content: line.substring(1),
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
        };
        currentHunk.lines.push(diffLine);
      }
      // Skip other lines (diff header, etc.)
    }

    return { filePath, hunks, isBinary: false, additions: totalAdd, deletions: totalDel };
  }

  private static parseStatusChar(c: string): FileChangeStatus {
    switch (c) {
      case 'M':
        return 'modified';
      case 'A':
        return 'added';
      case 'D':
        return 'deleted';
      case 'R':
        return 'renamed';
      case 'C':
        return 'added'; // copied → treat as added
      case 'U':
        return 'conflicted';
      default:
        return 'modified';
    }
  }
}
