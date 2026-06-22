import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs } from './validate';
import { AutoUpdateService } from '../services/AutoUpdateService';

export function registerAutoUpdateIpc(): void {
  ipcMain.handle('autoUpdate:check', () => AutoUpdateService.checkForUpdates({ source: 'user' }));
  ipcMain.handle('autoUpdate:download', () => AutoUpdateService.downloadUpdate());
  ipcMain.handle('autoUpdate:quitAndInstall', () => AutoUpdateService.quitAndInstall());
  ipcMain.handle('autoUpdate:getEnabled', () => ({
    success: true,
    data: AutoUpdateService.readPreference(),
  }));
  ipcMain.handle('autoUpdate:setEnabled', (_event, enabled: boolean) => {
    parseArgs('autoUpdate:setEnabled', z.boolean(), enabled);
    return AutoUpdateService.setEnabled(enabled);
  });
  ipcMain.handle('autoUpdate:getStatus', () => AutoUpdateService.getStatus());
}
