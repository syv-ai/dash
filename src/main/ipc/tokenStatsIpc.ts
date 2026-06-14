import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs } from './validate';
import { tokenStatsService } from '../services/TokenStatsService';

export function registerTokenStatsIpc(): void {
  ipcMain.handle('tokenStats:getProject', (_event, projectId: string) => {
    try {
      parseArgs('tokenStats:getProject', z.string(), projectId);
      return { success: true, data: tokenStatsService.getProjectStats(projectId) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('tokenStats:getGlobal', () => {
    try {
      return { success: true, data: tokenStatsService.getGlobalStats() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
