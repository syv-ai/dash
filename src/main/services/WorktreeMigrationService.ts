import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WorktreeMigrationProject, WorktreeMigrationResult } from '@shared/types';
import { DatabaseService } from './DatabaseService';
import { worktreeService } from './WorktreeService';
import { listForTask, killPtyAwait, removeTaskSession } from './ptyManager';
import { supervisorService } from './SupervisorService';
import { buildMigrationPlan, isWorktreeLockedError } from './worktreeMigrationPlan';
import { deleteTaskWithAddons } from '../addonHost/registry';

const execFileAsync = promisify(execFile);

function errorText(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  if (typeof e?.stderr === 'string' && e.stderr.trim()) return e.stderr.trim();
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * One-time move of task worktrees from the pre-0.16 `<parent>/worktrees/`
 * layout to `<repo>/.claude/worktrees/` (the location Claude Code assumes).
 * Driven by the launch dialog (WorktreeMigrationModal): `plan()` lists what
 * would move, `migrateProject()` moves one project's tasks and reports per-task
 * outcomes so a single failure never blocks the rest.
 *
 * A move is `git worktree move` plus a DB path update; the worktree keeps its
 * branch, files, `.claude/settings.local.json`, `.dash/` config and ports
 * export file. Task ports and terminal snapshots are keyed by task id and need
 * nothing. Claude transcripts stay under the old cwd's encoded dir, which is
 * why `previous_path` is recorded (see Task.previousPath).
 */
class WorktreeMigrationServiceImpl {
  plan(): WorktreeMigrationProject[] {
    const projects = DatabaseService.getProjects();
    const tasksByProject = Object.fromEntries(
      projects.map((p) => [p.id, DatabaseService.getTasks(p.id)] as const),
    );
    return buildMigrationPlan(projects, tasksByProject, {
      getLegacyWorktreesDir: (p) => worktreeService.getLegacyWorktreesDir(p),
      getWorktreesDir: (p) => worktreeService.getWorktreesDir(p),
      pathExists: (p) => fs.existsSync(p),
      isWorktreeDir: (p) => fs.existsSync(path.join(p, '.git')),
    });
  }

  /**
   * Move one project's legacy worktrees. Stale entries (directory left behind
   * after git dropped the worktree) cannot be moved; with `removeStale` they
   * are deleted instead — task row, supervisor session and leftover directory
   * — otherwise they are reported as failures like before.
   */
  async migrateProject(
    projectId: string,
    opts: { removeStale?: boolean } = {},
  ): Promise<WorktreeMigrationResult> {
    const result: WorktreeMigrationResult = { projectId, moved: [], removed: [], failed: [] };
    const group = this.plan().find((p) => p.projectId === projectId);
    if (!group) return result;

    await worktreeService.ensureWorktreesDir(group.projectPath);

    for (const task of group.tasks) {
      try {
        if (task.stale) {
          if (!opts.removeStale) {
            throw new Error(
              `Not a git worktree any more (only leftovers remain): ${task.fromPath}`,
            );
          }
          await this.removeStaleTask(task);
          result.removed.push(task.taskId);
          continue;
        }
        await this.migrateTask(group.projectPath, task);
        result.moved.push(task.taskId);
      } catch (err) {
        const error = errorText(err);
        console.error(`[WorktreeMigration] ${task.taskName} (${task.fromPath}): ${error}`);
        result.failed.push({ taskId: task.taskId, taskName: task.taskName, error });
      }
    }

    this.removeEmptyDir(group.legacyDir);
    return result;
  }

  private async migrateTask(
    projectPath: string,
    task: WorktreeMigrationProject['tasks'][number],
  ): Promise<void> {
    if (fs.existsSync(task.toPath)) {
      if (!fs.existsSync(task.fromPath)) {
        // Already moved by hand (or a previous partial run): just record it.
        DatabaseService.relocateTask(task.taskId, task.toPath, task.fromPath);
        return;
      }
      throw new Error(`Destination already exists: ${task.toPath}`);
    }
    if (!fs.existsSync(task.fromPath)) {
      throw new Error(`Worktree directory is missing: ${task.fromPath}`);
    }

    // Nothing may run inside the directory while it moves: kill the task's
    // PTYs (attach client and shells), and if the task already has a job
    // under the supervisor, stop it and forget it — the supervisor keeps a
    // job bound to its cwd and would refuse a later `--bg --resume` from the
    // new path ("working directory no longer exists") while queueing the
    // prompt. The session id stays on the task, so the next open resumes it.
    for (const ptyId of listForTask(task.taskId)) {
      await killPtyAwait(ptyId);
    }
    const record = DatabaseService.getTask(task.taskId);
    if (record?.jobId) {
      await supervisorService.stop(record.jobId).catch(() => {});
      await supervisorService.remove(record.jobId);
      DatabaseService.setTaskSession(task.taskId, { jobId: null, sessionId: record.sessionId });
    }

    await this.gitWorktreeMove(projectPath, task.fromPath, task.toPath);
    DatabaseService.relocateTask(task.taskId, task.toPath, task.fromPath);
  }

  /**
   * Delete a stale task: forget its supervisor session (transcript kept), drop
   * the row, and remove the leftover directory. The directory is only removed
   * when it still is not a worktree, so a repo that regained one in between is
   * never touched.
   */
  private async removeStaleTask(task: WorktreeMigrationProject['tasks'][number]): Promise<void> {
    for (const ptyId of listForTask(task.taskId)) {
      await killPtyAwait(ptyId);
    }
    await removeTaskSession(task.taskId).catch((err) =>
      console.warn(`[WorktreeMigration] session removal failed for ${task.taskName}:`, err),
    );
    deleteTaskWithAddons(task.taskId);
    if (fs.existsSync(task.fromPath) && !fs.existsSync(path.join(task.fromPath, '.git'))) {
      fs.rmSync(task.fromPath, { recursive: true, force: true });
    }
  }

  private async gitWorktreeMove(cwd: string, from: string, to: string): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'move', from, to], { cwd });
    } catch (err) {
      const message = errorText(err);
      if (!isWorktreeLockedError(message)) throw new Error(message);
      // Claude Code locks the worktree of a running session and a killed one
      // can leave the lock behind; lifting it is safe because the directory
      // moves intact.
      await execFileAsync('git', ['worktree', 'unlock', from], { cwd });
      await execFileAsync('git', ['worktree', 'move', from, to], { cwd });
    }
  }

  /** Remove the legacy `<parent>/worktrees/` dir once nothing is left in it. */
  private removeEmptyDir(dir: string): void {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      // Best effort — an empty leftover dir is harmless.
    }
  }
}

export const worktreeMigrationService = new WorktreeMigrationServiceImpl();
