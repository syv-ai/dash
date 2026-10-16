import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { worktreeService } from '../services/WorktreeService';
import { worktreePoolService } from '../services/WorktreePoolService';
import { worktreeMigrationService } from '../services/WorktreeMigrationService';
import { TelemetryService } from '../services/TelemetryService';

export function registerWorktreeIpc(): void {
  ipcMain.handle(
    'worktree:remove',
    async (
      _event,
      args: {
        projectPath: string;
        worktreePath: string;
        branch: string;
        options?: {
          deleteWorktreeDir?: boolean;
          deleteLocalBranch?: boolean;
          deleteRemoteBranch?: boolean;
          teardownScript?: string | null;
        };
      },
    ) => {
      try {
        parseArgs(
          'worktree:remove',
          z.looseObject({
            projectPath: z.string(),
            worktreePath: z.string(),
            branch: z.string(),
            options: z
              .looseObject({
                deleteWorktreeDir: z.boolean().optional(),
                deleteLocalBranch: z.boolean().optional(),
                deleteRemoteBranch: z.boolean().optional(),
                teardownScript: z.string().nullable().optional(),
              })
              .optional(),
          }),
          args,
        );
        await worktreeService.removeWorktree(
          args.projectPath,
          args.worktreePath,
          args.branch,
          args.options,
        );
        TelemetryService.capture('worktree_removed');
        return { success: true };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle(
    'worktree:ensureReserve',
    async (_event, args: { projectId: string; projectPath: string }) => {
      try {
        parseArgs(
          'worktree:ensureReserve',
          z.looseObject({ projectId: z.string(), projectPath: z.string() }),
          args,
        );
        await worktreePoolService.ensureReserve(args.projectId, args.projectPath);
        return { success: true };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

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

  ipcMain.handle('worktree:hasReserve', async (_event, projectId: string) => {
    try {
      parseArgs('worktree:hasReserve', z.string(), projectId);
      return { success: true, data: worktreePoolService.hasReserve(projectId) };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
