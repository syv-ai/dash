import { ipcMain } from 'electron';
import { RtkService } from '../services/RtkService';
import { refreshActivePtyHooks } from '../services/ptyManager';

export function registerRtkIpc(): void {
  ipcMain.handle('rtk:getStatus', async () => {
    try {
      return { success: true, data: await RtkService.getStatus() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('rtk:setEnabled', (_event, enabled: boolean) => {
    try {
      RtkService.setEnabled(enabled);
      // Flip hooks live on every running Claude Code session — no restart needed.
      refreshActivePtyHooks();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Fire-and-forget: progress is streamed via rtk:downloadProgress events.
  ipcMain.handle('rtk:download', async () => {
    try {
      await RtkService.download();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('rtk:test', async () => {
    try {
      return { success: true, data: await RtkService.runHookTest() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
