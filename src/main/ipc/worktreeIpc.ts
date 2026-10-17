import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { worktreeMigrationService } from '../services/WorktreeMigrationService';
import { TelemetryService } from '../services/TelemetryService';

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
}
