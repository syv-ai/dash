import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import log from 'electron-log';

autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

let mainWindowRef: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
  win.on('closed', () => {
    mainWindowRef = null;
  });
}

function sendToRenderer(channel: string, payload?: unknown): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload);
  }
}

autoUpdater.on('update-available', (info: UpdateInfo) => {
  const notes =
    typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
        : undefined;
  sendToRenderer('update:available', {
    version: info.version,
    releaseNotes: notes,
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
  if (!app.isPackaged) {
    sendToRenderer('update:error', { message: 'Updates are not available in development mode' });
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    log.error('Failed to check for updates:', err);
    sendToRenderer('update:error', { message: err?.message ?? 'Failed to check for updates' });
  });
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => {
    log.error('Failed to download update:', err);
    sendToRenderer('update:error', { message: err?.message ?? 'Failed to download update' });
  });
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}
