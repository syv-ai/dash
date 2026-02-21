import { ipcMain } from 'electron';
import { worktreeService } from '../services/WorktreeService';

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
}
