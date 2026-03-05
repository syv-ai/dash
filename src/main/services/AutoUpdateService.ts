import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import type { BrowserWindow } from 'electron';
import type { IpcResponse } from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 10 * 1000; // 10 seconds

function send(channel: string, ...args: unknown[]): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch {
    // Best effort
  }
}

export class AutoUpdateService {
  static initialize(window: BrowserWindow): void {
    mainWindow = window;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      send('autoUpdate:available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('update-not-available', () => {
      send('autoUpdate:notAvailable');
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      send('autoUpdate:downloadProgress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', () => {
      send('autoUpdate:downloaded');
    });

    autoUpdater.on('error', (err: Error) => {
      send('autoUpdate:error', err.message);
    });

    // Initial check after delay
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, INITIAL_DELAY_MS);

    // Periodic checks
    checkInterval = setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }

  static async checkForUpdates(): Promise<IpcResponse<void>> {
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  static async downloadUpdate(): Promise<IpcResponse<void>> {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  static quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  static cleanup(): void {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }
}
