import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { toastRenderer } from '../utils/toast';
import type { WorktreeInfo, RemoveWorktreeOptions } from '@shared/types';
import { branchSlug, slugify } from '@shared/slug';
import { GithubService } from './GithubService';
import { GitService } from './GitService';
import { WORKTREES_EXCLUDE_ENTRY } from './gitExclude';

const execFileAsync = promisify(execFile);

const PRESERVE_PATTERNS = [
  '.env',
  '.env.keys',
  '.env.local',
  '.env.*.local',
  '.envrc',
  'docker-compose.override.yml',
];

/** Branches a task's delete never removes from the remote. */
const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'dev'];

/**
 * The origin branch that is `branch`'s own pushed work, with its tip as last
 * seen: only when `branch` tracks origin's branch of the same name (what
 * `push -u origin <branch>` sets) and isn't a shared one. Null otherwise: no
 * upstream (a fork PR's task, or a branch fetched from a PR ref under origin's
 * same name, which is someone else's branch), another branch's (one cut from
 * `origin/main` tracks main), or no tracking ref.
 */
export async function ownPushedBranch(
  cwd: string,
  branch: string,
): Promise<{ ref: string; sha: string } | null> {
  if (PROTECTED_BRANCHES.includes(branch)) return null;
  const upstream = await GitService.getUpstream(cwd, branch);
  if (upstream?.remote !== 'origin' || upstream.branch !== branch) return null;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`],
      { cwd },
    );
    return { ref: `refs/heads/${branch}`, sha: stdout.trim() };
  } catch {
    return null;
  }
}

/** Delete `own` from origin while it is still where the task last saw it:
 *  the lease refuses once anyone has moved it. */
export async function deleteOwnPushedBranch(
  cwd: string,
  { ref, sha }: { ref: string; sha: string },
): Promise<void> {
  await execFileAsync(
    'git',
    ['push', `--force-with-lease=${ref}:${sha}`, 'origin', '--delete', ref],
    {
      cwd,
    },
  );
}

export class WorktreeService {
  /**
   * Create a git worktree for a task.
   */
  async createWorktree(
    projectPath: string,
    taskName: string,
    options: {
      baseRef?: string;
      projectId: string;
      linkedIssueNumbers?: number[];
      pushRemote?: boolean;
    },
  ): Promise<WorktreeInfo> {
    // The branch keeps the name's slashes (`feature/foo-1nfe`); the folder is flat.
    const slug = this.slugify(taskName);
    const hash = this.generateShortHash();
    const branchName = `${branchSlug(taskName)}-${hash}`;

    const baseRef = await this.resolveBaseRef(projectPath, options.baseRef);
    const worktreesDir = await this.ensureWorktreesDir(projectPath);

    const worktreePath = path.join(worktreesDir, `${slug}-${hash}`);

    // Create worktree
    await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, baseRef], {
      cwd: projectPath,
    });

    // Copy preserved files
    await this.preserveFiles(projectPath, worktreePath);

    // Push to remote if requested (default: true for backwards compat)
    const pushRemote = options.pushRemote ?? true;
    if (pushRemote) {
      // Link branch to issues before pushing (createLinkedBranch needs the branch to not exist)
      if (options.linkedIssueNumbers && options.linkedIssueNumbers.length > 0) {
        void this.linkAndPushAsync(worktreePath, branchName, options.linkedIssueNumbers);
      } else {
        // Push branch with upstream tracking (async, non-blocking)
        this.pushBranchAsync(worktreePath, branchName);
      }
    }

    const id = this.stableIdFromPath(worktreePath);
    return {
      id,
      name: taskName,
      branch: branchName,
      path: worktreePath,
      projectId: options.projectId,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Remove a worktree and clean up branches.
   */
  async removeWorktree(
    projectPath: string,
    worktreePath: string,
    branch: string,
    options?: RemoveWorktreeOptions,
  ): Promise<void> {
    const deleteWorktreeDir = options?.deleteWorktreeDir ?? true;
    const deleteLocalBranch = options?.deleteLocalBranch ?? true;
    const deleteRemoteBranch = options?.deleteRemoteBranch ?? true;

    // Safety: never remove the project directory itself
    const normalizedProject = path.resolve(projectPath);
    const normalizedWorktree = path.resolve(worktreePath);
    if (normalizedWorktree === normalizedProject) {
      throw new Error('Cannot remove project directory as worktree');
    }

    if (deleteWorktreeDir) {
      // Verify this is actually a worktree
      try {
        const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
          cwd: projectPath,
        });
        if (!stdout.includes(normalizedWorktree)) {
          // Not a registered worktree, just do filesystem cleanup
          if (fs.existsSync(normalizedWorktree)) {
            fs.rmSync(normalizedWorktree, { recursive: true, force: true });
          }
          return;
        }
      } catch {
        // If list fails, continue with removal anyway
      }

      // Remove worktree
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: projectPath,
        });
      } catch {
        // Force filesystem removal if git worktree remove fails
        if (fs.existsSync(worktreePath)) {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
      }

      // Prune
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath });
      } catch {
        // Best effort
      }
    }

    // Read what the remote branch may be before the local branch (and its
    // upstream config) goes.
    const remoteBranch = deleteRemoteBranch ? await ownPushedBranch(projectPath, branch) : null;

    // Delete local branch
    if (deleteLocalBranch) {
      try {
        await execFileAsync('git', ['branch', '-D', branch], { cwd: projectPath });
      } catch {
        // May not exist
      }
    }

    // Delete remote branch (best effort, non-blocking), only while it is still
    // where the task last pushed it: the lease refuses it once anyone moved it.
    if (remoteBranch) deleteOwnPushedBranch(projectPath, remoteBranch).catch(() => {});
  }

  /**
   * Resolve the base ref for worktree creation.
   */
  async resolveBaseRef(projectPath: string, override?: string): Promise<string> {
    if (override) return override;

    // Try to get remote HEAD
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'show', 'origin'], {
        cwd: projectPath,
        timeout: 5000,
      });
      const match = stdout.match(/HEAD branch:\s*(\S+)/);
      if (match) return match[1]!;
    } catch {
      // Ignore
    }

    // Try current branch
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
        cwd: projectPath,
      });
      const branch = stdout.trim();
      if (branch) return branch;
    } catch {
      // Ignore
    }

    return 'main';
  }

  /**
   * Copy preserved files (.env, etc) from source to target.
   */
  async preserveFiles(from: string, to: string): Promise<void> {
    for (const pattern of PRESERVE_PATTERNS) {
      // Simple glob: if no wildcard, just check exact file
      if (!pattern.includes('*')) {
        const srcFile = path.join(from, pattern);
        const destFile = path.join(to, pattern);
        if (fs.existsSync(srcFile) && !fs.existsSync(destFile)) {
          try {
            fs.copyFileSync(srcFile, destFile, fs.constants.COPYFILE_EXCL);
          } catch {
            // Skip if exists
          }
        }
      } else {
        // For wildcard patterns, list files and match
        try {
          const files = fs.readdirSync(from);
          const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          for (const file of files) {
            if (regex.test(file)) {
              const srcFile = path.join(from, file);
              const destFile = path.join(to, file);
              if (!fs.existsSync(destFile)) {
                try {
                  fs.copyFileSync(srcFile, destFile, fs.constants.COPYFILE_EXCL);
                } catch {
                  // Skip
                }
              }
            }
          }
        } catch {
          // Skip
        }
      }
    }
  }

  private async linkAndPushAsync(
    cwd: string,
    branch: string,
    issueNumbers: number[],
  ): Promise<void> {
    try {
      // linkIssuesAsync ultimately calls GitHub's createLinkedBranch, which
      // creates the branch on the remote AND links it to the issue. Must run
      // before any explicit push, otherwise the branch already exists remotely
      // and the create-link call fails.
      await this.linkIssuesAsync(cwd, branch, issueNumbers);
      // The branch now exists on origin (via createLinkedBranch); set tracking.
      await execFileAsync('git', ['branch', '--set-upstream-to', `origin/${branch}`, branch], {
        cwd,
      });
    } catch {
      // Fallback: just push normally if linking failed
      this.pushBranchAsync(cwd, branch);
    }
  }

  private async linkIssuesAsync(
    cwd: string,
    branch: string,
    issueNumbers: number[],
  ): Promise<void> {
    for (const num of issueNumbers) {
      try {
        const issueUrl = await GithubService.linkBranch(cwd, num, branch);
        toastRenderer({
          kind: 'success',
          title: `Issue #${num} linked to branch '${branch}'`,
          action: { type: 'openUrl', label: 'Open', url: issueUrl },
        });
      } catch {
        // Best effort — gh may not be available
      }
    }
  }

  private async refExists(cwd: string, ref: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd });
      return true;
    } catch {
      return false;
    }
  }

  private pushBranchAsync(cwd: string, branch: string): void {
    execFileAsync('git', ['push', '-u', 'origin', branch], { cwd }).catch(() => {
      // Best effort — no remote is fine
    });
  }

  /**
   * Create a git worktree for an existing branch (no new branch created).
   */
  async createWorktreeFromExistingBranch(
    projectPath: string,
    taskName: string,
    branch: string,
    options: { projectId: string },
  ): Promise<WorktreeInfo> {
    // eslint-disable-next-line no-control-regex
    const hasControlChars = /[\x00-\x1f\x7f]/.test(branch);
    if (
      !branch ||
      branch.startsWith('-') ||
      hasControlChars ||
      /[ ~^:?*\\[\]@{]/.test(branch) ||
      branch.includes('..') ||
      branch.endsWith('.lock') ||
      branch.endsWith('/')
    ) {
      throw new Error(`Invalid branch name: '${branch}'`);
    }

    const dirSlug = this.slugify(branch);
    const hash = this.generateShortHash();
    const worktreesDir = await this.ensureWorktreesDir(projectPath);

    const worktreePath = path.join(worktreesDir, `${dirSlug}-${hash}`);

    // Resolve whether the branch exists locally or only on origin. `git worktree
    // add <path> <branch>` only works for local branches; remote-only branches
    // need `-b <branch> --track origin/<branch>` to create the local tracking
    // ref alongside the worktree.
    const localExists = await this.refExists(projectPath, branch);
    const worktreeArgs = localExists
      ? ['worktree', 'add', worktreePath, branch]
      : (await this.refExists(projectPath, `origin/${branch}`))
        ? ['worktree', 'add', '-b', branch, '--track', worktreePath, `origin/${branch}`]
        : ['worktree', 'add', worktreePath, branch]; // let git emit "invalid reference"

    try {
      await execFileAsync('git', worktreeArgs, {
        cwd: projectPath,
      });
    } catch (error: unknown) {
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? String((error as { stderr: unknown }).stderr)
          : error instanceof Error
            ? error.message
            : String(error);
      console.error('[WorktreeService.createWorktreeFromExistingBranch] failed', {
        branch,
        worktreePath,
        stderr,
      });
      if (/already checked out/i.test(stderr)) {
        const err = new Error(`Branch '${branch}' is already checked out in another worktree`);
        (err as Error & { cause?: unknown }).cause = error;
        throw err;
      }
      if (/pathspec .* did not match/i.test(stderr) || /invalid reference/i.test(stderr)) {
        const err = new Error(`Branch '${branch}' not found`);
        (err as Error & { cause?: unknown }).cause = error;
        throw err;
      }
      throw error;
    }

    try {
      await this.preserveFiles(projectPath, worktreePath);
    } catch (error) {
      // preserveFiles failed after the worktree was registered — roll back so
      // the branch isn't left half-checked-out and blocking future creates.
      console.error('[WorktreeService.createWorktreeFromExistingBranch] preserve failed', {
        worktreePath,
        error,
      });
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: projectPath,
        });
      } catch (cleanupError) {
        console.error(
          '[WorktreeService.createWorktreeFromExistingBranch] cleanup failed',
          cleanupError,
        );
      }
      throw error;
    }

    // No GitHub branch link for an existing branch: createLinkedBranch creates
    // the branch on the remote (a push nobody asked for), and fails for one
    // already there. TaskService comments the branch on linked issues instead.

    const id = this.stableIdFromPath(worktreePath);
    return {
      id,
      name: taskName,
      branch,
      path: worktreePath,
      projectId: options.projectId,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Where a project's task worktrees live: `<repo>/.claude/worktrees/`, the
   * layout Claude Code uses for its own worktrees. Keeping ours there means
   * `claude agents --cwd <repo>` lists task sessions, `@<repo>` targeting sees
   * the worktrees, and a background session inside one is recognised as an
   * already-isolated linked worktree instead of being re-isolated.
   */
  getWorktreesDir(projectPath: string): string {
    return path.join(path.resolve(projectPath), '.claude', 'worktrees');
  }

  /**
   * Pre-0.16 location, `<parent-of-repo>/worktrees/`. Only the migration
   * (WorktreeMigrationService) and the legacy reserve sweep still look here.
   */
  getLegacyWorktreesDir(projectPath: string): string {
    return path.join(path.dirname(path.resolve(projectPath)), 'worktrees');
  }

  /** True when `worktreePath` sits under the project's pre-0.16 worktrees dir. */
  isLegacyWorktreePath(projectPath: string, worktreePath: string): boolean {
    const legacy = this.getLegacyWorktreesDir(projectPath);
    const rel = path.relative(legacy, path.resolve(worktreePath));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  /**
   * Create the worktrees dir if needed and make sure the main checkout ignores
   * it (via `.git/info/exclude`, never the tracked `.gitignore`). Returns the dir.
   */
  async ensureWorktreesDir(projectPath: string): Promise<string> {
    const worktreesDir = this.getWorktreesDir(projectPath);
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }
    await this.ensureWorktreesExcluded(projectPath);
    return worktreesDir;
  }

  /**
   * Append `.claude/worktrees/` to the repository's private exclude file so
   * task worktrees never show up as untracked in the main checkout. Idempotent
   * and best-effort: a failure only means noisier `git status`, never a
   * broken task.
   */
  async ensureWorktreesExcluded(projectPath: string): Promise<void> {
    try {
      await GitService.ensureExcluded(projectPath, WORKTREES_EXCLUDE_ENTRY);
    } catch (err) {
      console.warn(
        `[WorktreeService] Could not update .git/info/exclude for ${projectPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Thin wrapper over the shared {@link slugify} so existing
   *  `worktreeService.slugify(...)` callers keep working. */
  slugify(name: string): string {
    return slugify(name);
  }

  generateShortHash(): string {
    return crypto.randomBytes(3).toString('hex').slice(0, 3);
  }

  stableIdFromPath(worktreePath: string): string {
    const hash = crypto.createHash('sha1').update(worktreePath).digest('hex').slice(0, 12);
    return `wt-${hash}`;
  }
}

export const worktreeService = new WorktreeService();
