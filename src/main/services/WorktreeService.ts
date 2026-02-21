import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import type { RemoveWorktreeOptions } from '@shared/types';

const execFileAsync = promisify(execFile);

export class WorktreeService {
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
}

export const worktreeService = new WorktreeService();
