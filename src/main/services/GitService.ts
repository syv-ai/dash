import { execFile, spawn } from 'child_process';
import { createParser, type ParserEvent } from './preCommitParser';
import { unlinkSync, promises as fsPromises } from 'fs';
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

/** Pull stderr off a node child-process error, falling back to message. */
function gitStderr(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === 'string' && e.stderr) return e.stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(error);
}

/** Wrap a translated message around the original error, preserving stderr/stack. */
function wrapGitError(message: string, cause: unknown): Error {
  const err = new Error(message);
  // ES2022 has Error.cause built-in, but we target ES2020 — assign manually.
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

export class GitService {
  /**
   * Fetch from remote and list remote branches sorted by most recent commit.
   */
  static async fetchAndListBranches(cwd: string): Promise<BranchInfo[]> {
    // Check if origin remote exists
    let hasOrigin = false;
    try {
      const { stdout } = await execFileAsync('git', ['remote'], { cwd, timeout: 5000 });
      hasOrigin = stdout.split('\n').some((r) => r.trim() === 'origin');
    } catch {
      // no remotes
    }

    if (hasOrigin) {
      // Consolidate loose refs into packed-refs first. Prevents "cannot lock ref:
      // is at X but expected Y" errors during fetch — those come from a loose ref
      // disagreeing with packed-refs (common in repos with frequent force-pushes).
      // Best-effort: a failure here isn't fatal, fetch may still succeed.
      try {
        await execFileAsync('git', ['pack-refs', '--all', '--prune'], {
          cwd,
          timeout: 10000,
        });
      } catch {
        // ignore — fetch will report its own error if there's a real problem
      }

      // Fetch with prune to sync with remote (30s timeout). Fetch failure is
      // non-fatal: we can still list remote-tracking refs from local state,
      // which is more useful than blocking the dialog. Only surface the error
      // if we end up with nothing to show.
      let fetchError: Error | null = null;
      try {
        await execFileAsync('git', ['fetch', '--prune', 'origin'], {
          cwd,
          timeout: 30000,
        });
      } catch (err: unknown) {
        const msg = String((err as { stderr?: string }).stderr || err);
        if (/could not read from remote repository/i.test(msg)) {
          fetchError = new Error(
            'Could not connect to remote repository. Check your network connection and SSH/HTTPS credentials.',
          );
        } else if (/authentication failed/i.test(msg) || /could not resolve host/i.test(msg)) {
          fetchError = new Error(
            'Authentication failed or host not reachable. Check your credentials and network.',
          );
        } else if (/not a git repository/i.test(msg)) {
          fetchError = new Error('This directory is not a git repository.');
        } else if (/timed out/i.test(msg) || (err as { killed?: boolean }).killed) {
          fetchError = new Error('Fetch timed out. Check your network connection and try again.');
        } else {
          const fatalMatch = msg.match(/fatal:\s*(.+)/i);
          fetchError = new Error(
            fatalMatch
              ? `Git fetch failed: ${fatalMatch[1]!.trim()}`
              : `Git fetch failed: ${msg.split('\n')[0]!.trim()}`,
          );
        }
        console.warn(`[GitService] fetch failed for ${cwd}: ${fetchError.message}`);
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

      // If fetch failed AND there's nothing cached locally, the failure is
      // genuinely actionable (auth, network, never-fetched remote) — surface it.
      if (fetchError && branches.length === 0) throw fetchError;

      // Enrich top branches with ahead/behind counts (limit to avoid slowness)
      await this.enrichBranchesWithAheadBehind(cwd, branches, 20);

      return branches;
    }

    // No remote — fall back to local branches
    try {
      const { stdout } = await execFileAsync(
        'git',
        [
          'branch',
          '--format=%(refname:short)\t%(objectname:short)\t%(committerdate:relative)',
          '--sort=-committerdate',
        ],
        { cwd, timeout: 15000 },
      );

      const branches: BranchInfo[] = [];
      for (const line of stdout.split('\n').filter(Boolean)) {
        const [name, shortHash, ...dateParts] = line.split('\t');
        if (!name) continue;
        branches.push({
          name,
          ref: name,
          shortHash: shortHash || '',
          relativeDate: dateParts.join('\t') || '',
        });
      }

      await this.enrichBranchesWithAheadBehind(cwd, branches, 20);

      return branches;
    } catch {
      // No commits yet — no branches to list
      return [];
    }
  }

  /**
   * Get full git status for a working directory.
   */
  static async getStatus(cwd: string): Promise<GitStatus> {
    const branch = await this.getBranch(cwd);
    const { hasUpstream, ahead, behind } = await this.getAheadBehind(cwd);
    const files = await this.getFileChanges(cwd);
    return { branch, hasUpstream, ahead, behind, files };
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
  static async getAheadBehind(
    cwd: string,
  ): Promise<{ hasUpstream: boolean; ahead: number; behind: number }> {
    try {
      const out = await git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
      const parts = out.trim().split(/\s+/);
      return {
        hasUpstream: true,
        behind: parseInt(parts[0] ?? '', 10) || 0,
        ahead: parseInt(parts[1] ?? '', 10) || 0,
      };
    } catch {
      return { hasUpstream: false, ahead: 0, behind: 0 };
    }
  }

  /**
   * Get list of changed files with their status and stat counts.
   */
  static async getFileChanges(cwd: string): Promise<FileChange[]> {
    const files: FileChange[] = [];

    // Get staged + unstaged changes via porcelain v2
    try {
      const out = await git(cwd, ['status', '--porcelain=v2', '--untracked-files=all']);
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

          const x = xy![0]!; // Index (staged) status
          const y = xy![1]!; // Working tree status

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
    // With --untracked-files=all git lists each file individually under .claude/,
    // so prefix-match catches them whether tracked or untracked.
    const filtered = files.filter((f) => !f.path.startsWith('.claude/'));

    // Get numstat for addition/deletion counts
    await this.enrichWithNumstat(cwd, filtered);
    // Count lines in untracked files (numstat doesn't cover them)
    await this.enrichUntrackedLineCounts(cwd, filtered);

    return filtered;
  }

  /**
   * For untracked files, populate `additions` with the file's total line count
   * (since `git diff --numstat` doesn't cover them). Skips files over 1 MB and
   * silently caps if there are too many untracked entries to keep getStatus
   * snappy on repos with huge unignored vendor dumps.
   */
  private static async enrichUntrackedLineCounts(cwd: string, files: FileChange[]): Promise<void> {
    const UNTRACKED_ENRICHMENT_CAP = 500;
    const UNTRACKED_FILE_SIZE_CAP = 1024 * 1024;
    const untracked = files.filter((f) => f.status === 'untracked');
    if (untracked.length === 0 || untracked.length > UNTRACKED_ENRICHMENT_CAP) return;
    await Promise.all(
      untracked.map(async (file) => {
        try {
          const abs = join(cwd, file.path);
          const stats = await fsPromises.stat(abs);
          if (!stats.isFile()) return;
          if (stats.size > UNTRACKED_FILE_SIZE_CAP) return;
          const buffer = await fsPromises.readFile(abs);
          let count = 0;
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === 0x0a) count++;
          }
          if (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a) count++;
          file.additions = count;
        } catch {
          // File vanished, unreadable, or permission denied — leave 0.
        }
      }),
    );
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
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0]!, 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1]!, 10) || 0;
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
   * Stage one or more files in a single git invocation. Atomic — either all
   * paths are added or none are, and we don't race on `.git/index.lock`.
   */
  static async stageFiles(cwd: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await git(cwd, ['add', '--', ...filePaths]);
  }

  /**
   * Stage every changed file in the working tree.
   */
  static async stageAll(cwd: string): Promise<void> {
    await git(cwd, ['add', '-A']);
  }

  /**
   * Unstage one or more files in a single git invocation.
   */
  static async unstageFiles(cwd: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await git(cwd, ['reset', 'HEAD', '--', ...filePaths]);
  }

  /**
   * Unstage everything currently in the index.
   */
  static async unstageAll(cwd: string): Promise<void> {
    await git(cwd, ['reset', 'HEAD']);
  }

  /**
   * Discard changes for one or more files. Splits the input into tracked vs.
   * untracked via a single status call so the tracked side becomes one
   * `git checkout` invocation and the untracked side becomes plain unlinks.
   */
  static async discardFiles(cwd: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    // `-z` gives NUL-delimited, unquoted paths so filenames with spaces or
    // non-ASCII bytes are reported verbatim (default `core.quotePath` would
    // wrap them in escaped quotes and break the exact-match against filePaths).
    const statusOut = await git(cwd, ['status', '--porcelain', '-z', '--', ...filePaths]);
    const untracked = new Set<string>();
    for (const entry of statusOut.split('\0')) {
      if (entry.startsWith('?? ')) {
        untracked.add(entry.slice(3));
      }
    }
    const tracked = filePaths.filter((p) => !untracked.has(p));
    if (tracked.length > 0) {
      await git(cwd, ['checkout', 'HEAD', '--', ...tracked]);
    }
    for (const p of untracked) {
      try {
        unlinkSync(join(cwd, p));
      } catch {
        // Already gone or unwritable — keep going.
      }
    }
  }

  /**
   * Commit staged changes.
   */
  static async commit(
    cwd: string,
    message: string,
    options: { allowEmpty?: boolean } = {},
  ): Promise<void> {
    const args = ['commit'];
    if (options.allowEmpty) args.push('--allow-empty');
    args.push('-m', message);
    await git(cwd, args);
  }

  /**
   * Append a path to the repo's root `.gitignore`. Creates the file if it
   * doesn't exist. No-ops if the path already appears as a literal entry.
   */
  static async addToGitignore(cwd: string, relPath: string): Promise<void> {
    const gitignorePath = join(cwd, '.gitignore');
    let existing = '';
    try {
      existing = await fsPromises.readFile(gitignorePath, 'utf8');
    } catch {
      // Doesn't exist yet — we'll create it.
    }
    const lines = existing.split('\n');
    const trimmed = lines.map((l) => l.trim());
    if (trimmed.includes(relPath)) return;
    const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
    const next = `${existing}${needsLeadingNewline ? '\n' : ''}${relPath}\n`;
    await fsPromises.writeFile(gitignorePath, next, 'utf8');
  }

  /**
   * Spawn `git commit` and stream parsed pre-commit/prek events.
   * Returns a cancel function that sends SIGTERM to the child.
   * `onClose` is called exactly once after the child exits.
   */
  static commitStreamed(
    cwd: string,
    message: string,
    options: { allowEmpty?: boolean },
    onEvent: (event: ParserEvent) => void,
    onClose: (result: { exitCode: number | null; signal: NodeJS.Signals | null }) => void,
  ): { cancel: () => void } {
    const args = ['commit'];
    if (options.allowEmpty) args.push('--allow-empty');
    args.push('-m', message);

    const child = spawn('git', args, { cwd });
    const parser = createParser();

    let outBuf = '';
    let errBuf = '';
    function pumpLines(chunk: Buffer, kind: 'out' | 'err') {
      const ref = kind === 'out' ? outBuf : errBuf;
      const combined = ref + chunk.toString('utf8');
      const parts = combined.split('\n');
      const tail = parts.pop() ?? '';
      if (kind === 'out') outBuf = tail;
      else errBuf = tail;
      for (const line of parts) {
        for (const ev of parser.feed(line)) onEvent(ev);
      }
    }

    child.stdout.on('data', (c: Buffer) => pumpLines(c, 'out'));
    child.stderr.on('data', (c: Buffer) => pumpLines(c, 'err'));
    child.on('close', (exitCode, signal) => {
      for (const tail of [outBuf, errBuf]) {
        if (tail.length > 0) {
          for (const ev of parser.feed(tail)) onEvent(ev);
        }
      }
      for (const ev of parser.flush()) onEvent(ev);
      onClose({ exitCode, signal });
    });

    return {
      cancel: () => {
        try {
          child.kill('SIGTERM');
        } catch {
          // Process may already be gone; close handler will fire regardless.
        }
      },
    };
  }

  /**
   * Push to remote.
   */
  static async push(cwd: string): Promise<void> {
    await git(cwd, ['push']);
  }

  /**
   * Check ahead/behind counts for a specific branch relative to its upstream.
   * First tries the configured upstream, then falls back to origin/<branch>.
   */
  static async getBranchAheadBehind(
    cwd: string,
    branch: string,
  ): Promise<{ hasUpstream: boolean; ahead: number; behind: number }> {
    for (const ref of [`${branch}@{upstream}`, `origin/${branch}`]) {
      try {
        const out = await git(cwd, ['rev-list', '--left-right', '--count', `${ref}...${branch}`]);
        const parts = out.trim().split(/\s+/);
        return {
          hasUpstream: true,
          behind: parseInt(parts[0] ?? '', 10) || 0,
          ahead: parseInt(parts[1] ?? '', 10) || 0,
        };
      } catch (error) {
        // Expected when this ref isn't a valid upstream (no tracking branch,
        // or origin/<branch> doesn't exist). Anything else is unexpected and
        // worth surfacing — timeouts, missing git binary, repo corruption.
        const stderr = gitStderr(error);
        const expected =
          /unknown revision/i.test(stderr) ||
          /bad revision/i.test(stderr) ||
          /ambiguous argument/i.test(stderr) ||
          /no such branch/i.test(stderr) ||
          /no upstream configured/i.test(stderr);
        if (!expected) {
          console.error('[GitService.getBranchAheadBehind] unexpected error', { branch, stderr });
        }
      }
    }
    return { hasUpstream: false, ahead: 0, behind: 0 };
  }

  /**
   * Local branch names (short form). Used to gate ahead/behind enrichment: a
   * remote branch with no local counterpart has nothing to be ahead/behind of,
   * and `<name>@{upstream}`/`origin/<name>...<name>` would just fail on the
   * missing local ref.
   */
  private static async getLocalBranchNames(cwd: string): Promise<Set<string>> {
    try {
      const out = await git(cwd, ['branch', '--format=%(refname:short)']);
      return new Set(
        out
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      );
    } catch {
      return new Set();
    }
  }

  /**
   * Enrich a list of branches with ahead/behind counts (best-effort, in-place).
   * Only branches that exist locally are enriched — ahead/behind relative to an
   * upstream is undefined for a remote branch that was never checked out.
   */
  private static async enrichBranchesWithAheadBehind(
    cwd: string,
    branches: BranchInfo[],
    limit: number,
  ): Promise<void> {
    const localNames = await this.getLocalBranchNames(cwd);
    const slice = branches.slice(0, limit).filter((b) => localNames.has(b.name));
    const results = await Promise.allSettled(
      slice.map((b) => this.getBranchAheadBehind(cwd, b.name)),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === 'fulfilled' && r.value.hasUpstream) {
        slice[i]!.upstream = { ahead: r.value.ahead, behind: r.value.behind };
      } else if (r.status === 'rejected') {
        console.error('[GitService.enrichBranchesWithAheadBehind] rejected', {
          branch: slice[i]!.name,
          reason: r.reason,
        });
      }
    }
  }

  /**
   * Checkout a branch in the working directory. Translates common git errors
   * into user-facing messages while preserving the original via Error.cause
   * and a console.error log for debugging.
   */
  static async checkoutBranch(cwd: string, branch: string): Promise<void> {
    try {
      await git(cwd, ['checkout', branch]);
    } catch (error: unknown) {
      const stderr = gitStderr(error);
      console.error('[GitService.checkoutBranch] failed', { branch, stderr });
      // The two "would be overwritten" cases need different advice — committed
      // changes can be stashed; untracked files cannot.
      if (/untracked working tree files would be overwritten/i.test(stderr)) {
        throw wrapGitError(
          `Cannot switch branches: untracked files in the working tree would be overwritten. Move or remove them first.`,
          error,
        );
      }
      if (/Your local changes to the following files would be overwritten/i.test(stderr)) {
        throw wrapGitError(
          'Cannot switch branches: you have uncommitted changes that would be overwritten. Commit or stash them first.',
          error,
        );
      }
      if (/pathspec .* did not match/i.test(stderr)) {
        throw wrapGitError(`Branch '${branch}' not found`, error);
      }
      throw error;
    }
  }

  static async remoteBranchExists(cwd: string, branch: string): Promise<boolean> {
    try {
      const output = await git(cwd, ['ls-remote', '--heads', 'origin', branch]);
      return output.trim().length > 0;
    } catch {
      return false;
    }
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
        hash: parts[0]!,
        shortHash: parts[1]!,
        parents: parts[2] ? parts[2].split(' ') : [],
        authorName: parts[3]!,
        authorDate: parseInt(parts[4]!, 10) || 0,
        subject: parts[5]!,
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
      hash: parts[0]!,
      shortHash: parts[1]!,
      parents: parts[2] ? parts[2].split(' ') : [],
      authorName: parts[3]!,
      authorDate: parseInt(parts[4]!, 10) || 0,
      subject: parts[5]!,
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
        filesChanged = parseInt(match[1]!, 10) || 0;
        additions = parseInt(match[2] ?? '', 10) || 0;
        deletions = parseInt(match[3] ?? '', 10) || 0;
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
      rowIndex.set(commits[i]!.hash, i);
    }

    for (let row = 0; row < commits.length; row++) {
      const commit = commits[row]!;
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
        const parentHash = commit.parents[pi]!;
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
        oldLine = parseInt(hunkMatch[1]!, 10);
        newLine = parseInt(hunkMatch[2]!, 10);
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
