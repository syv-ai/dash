import * as fs from 'fs';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { worktreeMigrationService } from '../services/WorktreeMigrationService';
import { TelemetryService } from '../services/TelemetryService';
import { DatabaseService } from '../services/DatabaseService';
import { worktreeService } from '../services/WorktreeService';
import { getSetupLog, isSetupRunning, listSetupRuns } from '../services/setupRuns';

export function registerWorktreeIpc(): void {
  // Pre-0.16 worktrees lived at `<parent>/worktrees/`; the launch dialog offers
  // to move them under `<repo>/.claude/worktrees/`. Plan is read-only.
  ipcMain.handle('worktree:migrationPlan', () => {
    try {
      return { success: true, data: worktreeMigrationService.plan() };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle(
    'worktree:migrate',
    async (_event, args: { projectId: string; removeStale?: boolean }) => {
      try {
        parseArgs(
          'worktree:migrate',
          z.looseObject({ projectId: z.string(), removeStale: z.boolean().optional() }),
          args,
        );
        const data = await worktreeMigrationService.migrateProject(args.projectId, {
          removeStale: args.removeStale === true,
        });
        TelemetryService.capture('worktree_migrated', {
          moved: data.moved.length,
          removed: data.removed.length,
          failed: data.failed.length,
        });
        return { success: true, data };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // Setup script runs: state and output live in main (setupRuns); the
  // renderer reads them here and follows `worktree:setupChanged`/`setupOutput`.
  ipcMain.handle('worktree:setupList', () => ({ success: true, data: listSetupRuns() }));

  ipcMain.handle('worktree:setupLog', (_event, worktreePath: string) => {
    try {
      parseArgs('worktree:setupLog', z.string(), worktreePath);
      return { success: true, data: getSetupLog(worktreePath) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('worktree:setupRerun', (_event, taskId: string) => {
    try {
      parseArgs('worktree:setupRerun', z.string(), taskId);
      const task = DatabaseService.getTask(taskId);
      if (!task) throw new Error('Task not found');
      if (!task.useWorktree) throw new Error('Setup only runs in a task worktree');
      const project = DatabaseService.getProjects().find((p) => p.id === task.projectId);
      if (!project) throw new Error('Project not found');
      if (!fs.existsSync(task.path)) {
        throw new Error(`The task's worktree folder is gone: ${task.path}`);
      }
      if (isSetupRunning(task.path)) throw new Error('Setup is already running for this task');
      const started = worktreeService.runSetupScriptAsync(
        task.path,
        task.branch,
        project.path,
        task.setupScript,
      );
      if (!started) throw new Error('No setup script is configured for this task');
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
