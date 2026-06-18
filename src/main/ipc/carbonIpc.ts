import { ipcMain } from 'electron';
import { computeCarbonStats } from '../services/CarbonService';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerCarbonIpc(): void {
  ipcMain.handle('carbon:getStats', async (_event, paths?: string[]) => {
    try {
      return { success: true, data: computeCarbonStats(paths) };
    } catch (err) {
      console.error('[carbonIpc.getStats]', err);
      return { success: false, error: errorMessage(err) };
    }
  });
}
