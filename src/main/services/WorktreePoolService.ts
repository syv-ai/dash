import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { worktreeService } from './WorktreeService';
import { GithubService } from './GithubService';
import type { ReserveWorktree, WorktreeInfo } from '@shared/types';

const execFileAsync = promisify(execFile);

const RESERVE_PREFIX = '_reserve';
const MAX_RESERVE_AGE_MS = 30 * 60 * 1000; // 30 minutes

export class WorktreePoolService {
  private reserves = new Map<string, ReserveWorktree>();
  private creationInProgress = new Set<string>();

  /**
   * Ensure a reserve worktree exists for a project.
   * Creates one in the background if needed.
   */
  async ensureReserve(projectId: string, projectPath: string): Promise<void> {
    // Skip if already creating
    if (this.creationInProgress.has(projectId)) return;

    // Check existing reserve
    const existing = this.reserves.get(projectId);
    if (existing) {
      const age = Date.now() - new Date(existing.createdAt).getTime();
      if (age < MAX_RESERVE_AGE_MS) return; // Fresh enough

      // Stale: delete it
      try {
        await this.deleteReserve(existing);
      } catch {
        // Best effort
      }
      this.reserves.delete(projectId);
    }

    this.creationInProgress.add(projectId);

    try {
      const hash = crypto.randomBytes(3).toString('hex');
      const branchName = `${RESERVE_PREFIX}/${hash}`;
      const worktreesDir = worktreeService.getWorktreesDir(projectPath);

      if (!fs.existsSync(worktreesDir)) {
        fs.mkdirSync(worktreesDir, { recursive: true });
      }

      const reservePath = path.join(worktreesDir, `${RESERVE_PREFIX}-${hash}`);

      await execFileAsync('git', ['worktree', 'add', '-b', branchName, reservePath, 'HEAD'], {
        cwd: projectPath,
      });

      const baseRef = await worktreeService.resolveBaseRef(projectPath);

      this.reserves.set(projectId, {
        id: worktreeService.stableIdFromPath(reservePath),
        path: reservePath,
        branch: branchName,
        projectId,
        projectPath,
        baseRef,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Best effort — reserve creation is optional
    } finally {
      this.creationInProgress.delete(projectId);
    }
  }

  /**
   * Claim a reserve worktree and transform it into a task worktree.
   * This is nearly instant (git worktree move + branch rename).
   */
  async claimReserve(
    projectId: string,
    taskName: string,
    baseRef?: string,
    linkedIssueNumbers?: number[],
  ): Promise<WorktreeInfo | null> {
    const reserve = this.reserves.get(projectId);
    if (!reserve) return null;

    // Check freshness
    const age = Date.now() - new Date(reserve.createdAt).getTime();
    if (age > MAX_RESERVE_AGE_MS) {
      this.reserves.delete(projectId);
      return null;
    }

    // Remove from pool immediately to prevent double-claim
    this.reserves.delete(projectId);

    const slug = worktreeService.slugify(taskName);
    const hash = worktreeService.generateShortHash();
    const newBranch = `${slug}-${hash}`;
    const worktreesDir = worktreeService.getWorktreesDir(reserve.projectPath);
    const newPath = path.join(worktreesDir, `${slug}-${hash}`);

    try {
      // Move worktree (instant)
      await execFileAsync('git', ['worktree', 'move', reserve.path, newPath], {
        cwd: reserve.projectPath,
      });

      // Rename branch (instant)
      await execFileAsync('git', ['branch', '-m', reserve.branch, newBranch], {
        cwd: reserve.projectPath,
      });

      // If different base ref needed, reset
      const targetBaseRef = baseRef || reserve.baseRef;
      if (targetBaseRef && targetBaseRef !== 'HEAD') {
        try {
          await execFileAsync('git', ['reset', '--hard', targetBaseRef], { cwd: newPath });
        } catch {
          // Best effort — may already be on correct ref
        }
      }

      // Link branch to issues before pushing (createLinkedBranch needs the branch to not exist)
      if (linkedIssueNumbers && linkedIssueNumbers.length > 0) {
        (async () => {
          try {
            for (const num of linkedIssueNumbers) {
              try {
                const issueUrl = await GithubService.linkBranch(newPath, num, newBranch);
                for (const win of BrowserWindow.getAllWindows()) {
                  if (!win.isDestroyed()) {
                    win.webContents.send('app:toast', {
                      message: `Issue #${num} linked to branch '${newBranch}'`,
                      url: issueUrl,
                    });
                  }
                }
              } catch {
                // Best effort
              }
            }
            await execFileAsync(
              'git',
              ['branch', '--set-upstream-to', `origin/${newBranch}`, newBranch],
              { cwd: newPath },
            );
          } catch {
            execFileAsync('git', ['push', '-u', 'origin', newBranch], { cwd: newPath }).catch(
              () => {},
            );
          }
        })();
      } else {
        // Push branch async (non-blocking)
        execFileAsync('git', ['push', '-u', 'origin', newBranch], { cwd: newPath }).catch(() => {});
      }

      // Fire-and-forget replenish
      this.ensureReserve(projectId, reserve.projectPath);

      return {
        id: worktreeService.stableIdFromPath(newPath),
        name: taskName,
        branch: newBranch,
        path: newPath,
        projectId,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
    } catch {
      // If claim fails, try regular creation
      return null;
    }
  }

  /**
   * Check if a reserve exists for a project.
   */
  hasReserve(projectId: string): boolean {
    const reserve = this.reserves.get(projectId);
    if (!reserve) return false;
    const age = Date.now() - new Date(reserve.createdAt).getTime();
    return age < MAX_RESERVE_AGE_MS;
  }

  /**
   * Cleanup orphaned reserve worktrees on startup.
   */
  async cleanupOrphanedReserves(): Promise<void> {
    // We can't scan everywhere, so just clean up known projects from the database
    try {
      const { DatabaseService } = await import('./DatabaseService');
      const projects = await DatabaseService.getProjects();

      for (const project of projects) {
        const worktreesDir = worktreeService.getWorktreesDir(project.path);
        if (!fs.existsSync(worktreesDir)) continue;

        const entries = fs.readdirSync(worktreesDir);
        for (const entry of entries) {
          if (entry.startsWith(`${RESERVE_PREFIX}-`)) {
            const reservePath = path.join(worktreesDir, entry);
            try {
              await execFileAsync('git', ['worktree', 'remove', '--force', reservePath], {
                cwd: project.path,
              });
            } catch {
              // Force filesystem removal
              try {
                fs.rmSync(reservePath, { recursive: true, force: true });
              } catch {
                // Give up
              }
            }
          }
        }

        // Prune
        try {
          await execFileAsync('git', ['worktree', 'prune'], { cwd: project.path });
        } catch {
          // Best effort
        }
      }
    } catch {
      // Best effort
    }
  }

  private async deleteReserve(reserve: ReserveWorktree): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', reserve.path], {
        cwd: reserve.projectPath,
      });
    } catch {
      if (fs.existsSync(reserve.path)) {
        fs.rmSync(reserve.path, { recursive: true, force: true });
      }
    }

    try {
      await execFileAsync('git', ['branch', '-D', reserve.branch], {
        cwd: reserve.projectPath,
      });
    } catch {
      // May not exist
    }
  }
}

export const worktreePoolService = new WorktreePoolService();
