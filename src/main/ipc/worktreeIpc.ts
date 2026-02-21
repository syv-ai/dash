import { ipcMain } from 'electron';
import { worktreeService } from '../services/WorktreeService';
import { worktreePoolService } from '../services/WorktreePoolService';

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
      },
    ) => {
      try {
        const data = await worktreeService.createWorktree(args.projectPath, args.taskName, {
          baseRef: args.baseRef,
          projectId: args.projectId,
          linkedIssueNumbers: args.linkedIssueNumbers,
        });
        return { success: true, data };
      } catch (error) {
        return { success: false, error: String(error) };
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
        await worktreeService.removeWorktree(
          args.projectPath,
          args.worktreePath,
          args.branch,
          args.options,
        );
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'worktree:ensureReserve',
    async (_event, args: { projectId: string; projectPath: string }) => {
      try {
        await worktreePoolService.ensureReserve(args.projectId, args.projectPath);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
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
      },
    ) => {
      try {
        const data = await worktreePoolService.claimReserve(
          args.projectId,
          args.taskName,
          args.baseRef,
          args.linkedIssueNumbers,
        );
        if (data) {
          return { success: true, data };
        }
        return { success: false, error: 'No reserve available' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('worktree:hasReserve', async (_event, projectId: string) => {
    try {
      return { success: true, data: worktreePoolService.hasReserve(projectId) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
