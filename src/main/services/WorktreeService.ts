import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { BrowserWindow } from 'electron';
import type { WorktreeInfo, RemoveWorktreeOptions } from '@shared/types';
import { slugify } from '@shared/slug';
import { GithubService } from './GithubService';
import {
  loadWorkspaceConfig,
  resolveSetupCommand,
  resolveTeardownCommand,
  buildWorkspaceEnv,
} from './WorkspaceConfigService';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/** Turn a newline-separated per-task script into a single shell command
 *  (commands joined with " && " so a failure short-circuits), or null when
 *  there are no non-empty commands. */
function scriptStringToCommand(script: string | null | undefined): string | null {
  const commands = (script ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return commands.length > 0 ? commands.join(' && ') : null;
}

const PRESERVE_PATTERNS = [
  '.env',
  '.env.keys',
  '.env.local',
  '.env.*.local',
  '.envrc',
  'docker-compose.override.yml',
];

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
      setupScript?: string | null;
    },
  ): Promise<WorktreeInfo> {
    const slug = this.slugify(taskName);
    const hash = this.generateShortHash();
    const branchName = `${slug}-${hash}`;

    const baseRef = await this.resolveBaseRef(projectPath, options.baseRef);
    const worktreesDir = this.getWorktreesDir(projectPath);

    // Ensure worktrees directory exists
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

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

    // Run worktree setup script (async, non-blocking)
    this.runSetupScriptAsync(worktreePath, branchName, projectPath, options.setupScript);

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

      // Run teardown before removal so the script can still read .dash/* in the worktree.
      await this.runTeardownAsync(worktreePath, projectPath, branch, options?.teardownScript);

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

    // Delete local branch
    if (deleteLocalBranch) {
      try {
        await execFileAsync('git', ['branch', '-D', branch], { cwd: projectPath });
      } catch {
        // May not exist
      }
    }

    // Delete remote branch (best effort, non-blocking)
    const protectedBranches = ['main', 'master', 'develop', 'dev'];
    if (deleteRemoteBranch && !protectedBranches.includes(branch)) {
      execFileAsync('git', ['push', 'origin', '--delete', branch], { cwd: projectPath }).catch(
        () => {},
      );
    }
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
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('app:toast', {
              message: `Issue #${num} linked to branch '${branch}'`,
              url: issueUrl,
            });
          }
        }
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
   * Resolve and run workspace teardown in the worktree just before it's removed.
   *
   * Sources, in priority order:
   *   1. `.dash/config.json` teardown commands (joined with ` && `)
   *   2. `bash <projectPath>/.dash/teardown.sh` if the script exists
   *
   * Awaited so cleanup (e.g. `docker compose down`) finishes before files vanish.
   * Failures are toasted but do not block removal — the user asked for the worktree gone.
   */
  async runTeardownAsync(
    worktreePath: string,
    projectPath: string,
    branch: string,
    teardownOverride?: string | null,
  ): Promise<void> {
    try {
      const config = loadWorkspaceConfig(worktreePath);
      let command: string | null;
      if (teardownOverride !== undefined && teardownOverride !== null) {
        command = scriptStringToCommand(teardownOverride);
      } else {
        const fallbackPath = path.join(projectPath, '.dash', 'teardown.sh');
        const fallbackScriptPath = fs.existsSync(fallbackPath) ? fallbackPath : null;
        command = resolveTeardownCommand({ config, fallbackScriptPath });
      }
      if (!command) return;

      const env = buildWorkspaceEnv({ worktreePath, projectPath, branch });
      const cwd = config?.cwd ? path.join(worktreePath, config.cwd) : worktreePath;

      await execAsync(command, {
        cwd,
        timeout: 30_000,
        env: { ...process.env, ...env },
      });
    } catch (error: unknown) {
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? String((error as { stderr: unknown }).stderr).trim()
          : '';
      const msg = stderr || (error instanceof Error ? error.message : String(error));
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('app:toast', {
            message: `Workspace teardown failed: ${msg.slice(0, 200)}`,
          });
        }
      }
    }
  }

  /**
   * Resolve and run workspace setup in the new worktree directory.
   *
   * Sources, in priority order:
   *   1. `.dash/config.json` setup commands (joined with ` && `)
   *   2. `bash <projectPath>/.dash/setup.sh` if the script exists
   *
   * Async, non-blocking — sends a toast on failure.
   */
  runSetupScriptAsync(
    worktreePath: string,
    branchName: string,
    projectPath: string,
    setupOverride?: string | null,
  ): void {
    void (async () => {
      try {
        const config = loadWorkspaceConfig(worktreePath);
        // A per-task override (even an empty one) supersedes the project config:
        // empty means "this worktree intentionally has no setup".
        const overrideCommand = scriptStringToCommand(setupOverride);
        let command: string | null;
        if (setupOverride !== undefined && setupOverride !== null) {
          command = overrideCommand;
        } else {
          const fallbackPath = path.join(projectPath, '.dash', 'setup.sh');
          const fallbackScriptPath = fs.existsSync(fallbackPath) ? fallbackPath : null;
          command = resolveSetupCommand({ config, fallbackScriptPath });
        }
        if (!command) return;

        const env = buildWorkspaceEnv({ worktreePath, projectPath, branch: branchName });
        const cwd = config?.cwd ? path.join(worktreePath, config.cwd) : worktreePath;

        await execAsync(command, {
          cwd,
          timeout: 60_000,
          env: { ...process.env, ...env },
        });
      } catch (error: unknown) {
        const stderr =
          error && typeof error === 'object' && 'stderr' in error
            ? String((error as { stderr: unknown }).stderr).trim()
            : '';
        const msg = stderr || (error instanceof Error ? error.message : String(error));
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('app:toast', {
              message: `Workspace setup failed: ${msg.slice(0, 200)}`,
            });
          }
        }
      }
    })();
  }

  /**
   * Create a git worktree for an existing branch (no new branch created).
   */
  async createWorktreeFromExistingBranch(
    projectPath: string,
    taskName: string,
    branch: string,
    options: { projectId: string; linkedIssueNumbers?: number[]; setupScript?: string | null },
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
    const worktreesDir = this.getWorktreesDir(projectPath);

    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

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

    // For existing branches, only link issues — do not push, since the branch
    // already exists and the user manages its remote state.
    if (options.linkedIssueNumbers && options.linkedIssueNumbers.length > 0) {
      void this.linkIssuesAsync(worktreePath, branch, options.linkedIssueNumbers);
    }

    this.runSetupScriptAsync(worktreePath, branch, projectPath, options.setupScript);

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

  getWorktreesDir(projectPath: string): string {
    return path.join(path.dirname(path.resolve(projectPath)), 'worktrees');
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
