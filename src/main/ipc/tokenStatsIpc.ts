import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { tokenStatsService } from '../services/TokenStatsService';

export function registerTokenStatsIpc(): void {
  ipcMain.handle('tokenStats:getProject', (_event, projectId: string) => {
    try {
      parseArgs('tokenStats:getProject', z.string(), projectId);
      return { success: true, data: tokenStatsService.getProjectStats(projectId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('tokenStats:getGlobal', () => {
    try {
      return { success: true, data: tokenStatsService.getGlobalStats() };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
