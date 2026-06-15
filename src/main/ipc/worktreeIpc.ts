import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { worktreeService } from '../services/WorktreeService';
import { worktreePoolService } from '../services/WorktreePoolService';
import { TelemetryService } from '../services/TelemetryService';

export function registerWorktreeIpc(): void {
  ipcMain.handle(
    'worktree:create',
    async (
      _event,
      args: {
        projectPath: string;
        taskName: string;
        baseRef?: string;
        projectId: string;
        linkedIssueNumbers?: number[];
        pushRemote?: boolean;
      },
    ) => {
      try {
        parseArgs(
          'worktree:create',
          z.looseObject({
            projectPath: z.string(),
            taskName: z.string(),
            baseRef: z.string().optional(),
            projectId: z.string(),
            linkedIssueNumbers: z.array(z.number()).optional(),
            pushRemote: z.boolean().optional(),
          }),
          args,
        );
        const data = await worktreeService.createWorktree(args.projectPath, args.taskName, {
          baseRef: args.baseRef,
          projectId: args.projectId,
          linkedIssueNumbers: args.linkedIssueNumbers,
          pushRemote: args.pushRemote,
        });
        TelemetryService.capture('worktree_created');
        return { success: true, data };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

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

  ipcMain.handle(
    'worktree:claimReserve',
    async (
      _event,
      args: {
        projectId: string;
        taskName: string;
        baseRef?: string;
        linkedIssueNumbers?: number[];
        pushRemote?: boolean;
      },
    ) => {
      try {
        parseArgs(
          'worktree:claimReserve',
          z.looseObject({
            projectId: z.string(),
            taskName: z.string(),
            baseRef: z.string().optional(),
            linkedIssueNumbers: z.array(z.number()).optional(),
            pushRemote: z.boolean().optional(),
          }),
          args,
        );
        const data = await worktreePoolService.claimReserve(
          args.projectId,
          args.taskName,
          args.baseRef,
          args.linkedIssueNumbers,
          args.pushRemote,
        );
        if (data) {
          return { success: true, data };
        }
        return { success: false, error: 'No reserve available' };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle(
    'worktree:createFromExisting',
    async (
      _event,
      args: {
        projectPath: string;
        taskName: string;
        branch: string;
        projectId: string;
        linkedIssueNumbers?: number[];
      },
    ) => {
      try {
        parseArgs(
          'worktree:createFromExisting',
          z.looseObject({
            projectPath: z.string(),
            taskName: z.string(),
            branch: z.string(),
            projectId: z.string(),
            linkedIssueNumbers: z.array(z.number()).optional(),
          }),
          args,
        );
        const data = await worktreeService.createWorktreeFromExistingBranch(
          args.projectPath,
          args.taskName,
          args.branch,
          {
            projectId: args.projectId,
            linkedIssueNumbers: args.linkedIssueNumbers,
          },
        );
        TelemetryService.capture('worktree_created_existing_branch');
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
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
