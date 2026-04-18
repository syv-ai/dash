import { ipcMain } from 'electron';
import { RtkService } from '../services/RtkService';
import { refreshActivePtyHooks } from '../services/ptyManager';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerRtkIpc(): void {
  ipcMain.handle('rtk:getStatus', async () => {
    try {
      return { success: true, data: await RtkService.getStatus() };
    } catch (error) {
      console.error('[rtk:getStatus]', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('rtk:setEnabled', async (_event, enabled: boolean) => {
    try {
      if (enabled) {
        // Refuse to enable without a resolvable binary; otherwise the toggle
        // would show "on" while buildPreToolUseHooks silently omits the entry.
        const status = await RtkService.getStatus();
        if (!status.installed) {
          return { success: false, error: 'rtk is not installed' };
        }
      }
      RtkService.setEnabled(enabled);
      refreshActivePtyHooks();
      return { success: true };
    } catch (error) {
      console.error('[rtk:setEnabled]', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('rtk:download', async () => {
    try {
      await RtkService.download();
      // Refresh hook JSON in active PTYs so a download while the toggle is
      // already on starts rewriting immediately.
      refreshActivePtyHooks();
      return { success: true };
    } catch (error) {
      console.error('[rtk:download]', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('rtk:test', async () => {
    try {
      return { success: true, data: await RtkService.runHookTest() };
    } catch (error) {
      console.error('[rtk:test]', error);
      return { success: false, error: errorMessage(error) };
    }
  });
}
