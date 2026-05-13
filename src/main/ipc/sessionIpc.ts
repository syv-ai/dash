import { ipcMain } from 'electron';
import { startWatching, stopWatching, getSessionData } from '../services/SessionWatcherService';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerSessionIpc(): void {
  ipcMain.handle('session:watch', async (_event, args: { taskId: string; taskPath: string }) => {
    try {
      const result = startWatching(args.taskId, args.taskPath);
      if (!result.ok) return { success: false, error: result.error };
      return { success: true };
    } catch (err) {
      console.error('[sessionIpc.watch]', { args, err });
      return { success: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle('session:unwatch', async (_event, taskId: string) => {
    try {
      stopWatching(taskId);
      return { success: true };
    } catch (err) {
      console.error('[sessionIpc.unwatch]', { taskId, err });
      return { success: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle('session:getMessages', async (_event, taskId: string) => {
    try {
      return { success: true, data: getSessionData(taskId) };
    } catch (err) {
      console.error('[sessionIpc.getMessages]', { taskId, err });
      return { success: false, error: errorMessage(err) };
    }
  });
}
