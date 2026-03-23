import { ipcMain } from 'electron';
import {
  startWatching,
  stopWatching,
  getSessionData,
  getSubagentData,
} from '../services/SessionWatcherService';

export function registerSessionIpc(): void {
  ipcMain.handle('session:watch', async (_event, args: { taskId: string; taskPath: string }) => {
    try {
      startWatching(args.taskId, args.taskPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('session:unwatch', async (_event, taskId: string) => {
    try {
      stopWatching(taskId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('session:getMessages', async (_event, taskId: string) => {
    try {
      const data = getSessionData(taskId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'session:getSubagent',
    async (_event, args: { taskId: string; agentId: string }) => {
      try {
        const data = getSubagentData(args.taskId, args.agentId);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );
}
