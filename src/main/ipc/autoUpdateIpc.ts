import { ipcMain } from 'electron';
import { AutoUpdateService } from '../services/AutoUpdateService';

export function registerAutoUpdateIpc(): void {
  ipcMain.handle('autoUpdate:check', () => AutoUpdateService.checkForUpdates());
  ipcMain.handle('autoUpdate:download', () => AutoUpdateService.downloadUpdate());
  ipcMain.handle('autoUpdate:quitAndInstall', () => AutoUpdateService.quitAndInstall());
}
