import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { BrowserWindow } from 'electron';
import type { WorktreeInfo, RemoveWorktreeOptions } from '@shared/types';
import { GithubService } from './GithubService';

const execFileAsync = promisify(execFile);

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
    options: { baseRef?: string; projectId: string; linkedIssueNumbers?: number[] },
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

    // Link branch to issues before pushing (createLinkedBranch needs the branch to not exist)
    if (options.linkedIssueNumbers && options.linkedIssueNumbers.length > 0) {
      this.linkAndPushAsync(worktreePath, branchName, options.linkedIssueNumbers);
    } else {
      // Push branch with upstream tracking (async, non-blocking)
      this.pushBranchAsync(worktreePath, branchName);
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

    // Delete local branch
    if (deleteLocalBranch) {
      try {
        await execFileAsync('git', ['branch', '-D', branch], { cwd: projectPath });
      } catch {
        // May not exist
      }
    }

    // Delete remote branch (best effort, non-blocking)
    if (deleteRemoteBranch) {
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
      if (match) return match[1];
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
  private async preserveFiles(from: string, to: string): Promise<void> {
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
      // createLinkedBranch creates the branch on the remote AND links it to the issue.
      // Must happen before push so the branch doesn't already exist on the remote.
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
      // Set upstream tracking (branch already exists on remote from createLinkedBranch)
      await execFileAsync('git', ['branch', '--set-upstream-to', `origin/${branch}`, branch], {
        cwd,
      });
    } catch {
      // Fallback: just push normally if linking failed
      this.pushBranchAsync(cwd, branch);
    }
  }

  private pushBranchAsync(cwd: string, branch: string): void {
    execFileAsync('git', ['push', '-u', 'origin', branch], { cwd }).catch(() => {
      // Best effort — no remote is fine
    });
  }

  getWorktreesDir(projectPath: string): string {
    return path.join(path.dirname(projectPath), 'worktrees');
  }

  slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
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
