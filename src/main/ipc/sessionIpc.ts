import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { startWatching, stopWatching, getSessionData } from '../services/SessionWatcherService';

export function registerSessionIpc(): void {
  ipcMain.handle('session:watch', async (_event, args: { taskId: string; taskPath: string }) => {
    try {
      parseArgs('session:watch', z.looseObject({ taskId: z.string(), taskPath: z.string() }), args);
      const result = startWatching(args.taskId, args.taskPath);
      if (!result.ok) return { success: false, error: result.error };
      return { success: true };
    } catch (err) {
      console.error('[sessionIpc.watch]', { args, err });
      return errorResponse(err);
    }
  });

  ipcMain.handle('session:unwatch', async (_event, taskId: string) => {
    try {
      parseArgs('session:unwatch', z.string(), taskId);
      stopWatching(taskId);
      return { success: true };
    } catch (err) {
      console.error('[sessionIpc.unwatch]', { taskId, err });
      return errorResponse(err);
    }
  });

  ipcMain.handle('session:getMessages', async (_event, taskId: string) => {
    try {
      parseArgs('session:getMessages', z.string(), taskId);
      return { success: true, data: getSessionData(taskId) };
    } catch (err) {
      console.error('[sessionIpc.getMessages]', { taskId, err });
      return errorResponse(err);
    }
  });
}
