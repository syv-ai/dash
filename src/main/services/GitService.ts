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
} from '@shared/types';

const execFileAsync = promisify(execFile);

const MAX_DIFF_SIZE = 1024 * 1024; // 1MB max diff output

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
    await execFileAsync('git', ['fetch', '--prune', 'origin'], {
      cwd,
      timeout: 30000,
    });

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

    // Get numstat for addition/deletion counts
    await this.enrichWithNumstat(cwd, files);

    return files;
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
        '/dev/null',
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
