import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow } from 'electron';
import log from 'electron-log';

autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendToRenderer(channel: string, payload?: unknown): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send(channel, payload);
  }
}

autoUpdater.on('update-available', (info: UpdateInfo) => {
  sendToRenderer('update:available', {
    version: info.version,
    releaseNotes: info.releaseNotes,
  });
});

autoUpdater.on('update-not-available', () => {
  sendToRenderer('update:not-available');
});

autoUpdater.on('download-progress', (progress) => {
  sendToRenderer('update:download-progress', {
    percent: progress.percent,
  });
});

autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
  sendToRenderer('update:downloaded', { version: info.version });
});

autoUpdater.on('error', (err: Error) => {
  sendToRenderer('update:error', { message: err.message });
});

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates();
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate();
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}
