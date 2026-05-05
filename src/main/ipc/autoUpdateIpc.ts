import { ipcMain } from 'electron';
import { AutoUpdateService } from '../services/AutoUpdateService';

export function registerAutoUpdateIpc(): void {
  ipcMain.handle('autoUpdate:check', () => AutoUpdateService.checkForUpdates());
  ipcMain.handle('autoUpdate:download', () => AutoUpdateService.downloadUpdate());
  ipcMain.handle('autoUpdate:quitAndInstall', () => AutoUpdateService.quitAndInstall());
  ipcMain.handle('autoUpdate:getEnabled', () => ({
    success: true,
    data: AutoUpdateService.readPreference(),
  }));
  ipcMain.handle('autoUpdate:setEnabled', (_event, enabled: boolean) =>
    AutoUpdateService.setEnabled(enabled),
  );
}
