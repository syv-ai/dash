import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import type { IpcResponse } from '@shared/types';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';

let mainWindow: BrowserWindow | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialCheckTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckTime = 0;
let state: UpdateState = 'idle';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 10 * 1000; // 10 seconds
const CHECK_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

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
    // Clean up any previous listeners to prevent duplicates
    autoUpdater.removeAllListeners();
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (initialCheckTimer) {
      clearTimeout(initialCheckTimer);
      initialCheckTimer = null;
    }

    mainWindow = window;
    state = 'idle';

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      state = 'available';
      send('autoUpdate:available', { version: info.version });
    });

    autoUpdater.on('update-not-available', () => {
      state = 'idle';
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
      state = 'ready';
      send('autoUpdate:downloaded');
    });

    autoUpdater.on('error', () => {
      // Reset to previous valid state on error
      if (state === 'checking') state = 'idle';
      if (state === 'downloading') state = 'available';
      send('autoUpdate:error', 'Update failed. Please try again later.');
    });

    // Initial check after delay
    initialCheckTimer = setTimeout(() => {
      initialCheckTimer = null;
      autoUpdater.checkForUpdates().catch(() => {});
    }, INITIAL_DELAY_MS);

    // Periodic checks
    checkInterval = setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }

  static setWindow(window: BrowserWindow): void {
    mainWindow = window;
  }

  static async checkForUpdates(): Promise<IpcResponse<void>> {
    const now = Date.now();
    if (now - lastCheckTime < CHECK_COOLDOWN_MS) {
      return { success: true }; // Silently skip — too soon
    }
    if (state === 'downloading' || state === 'ready') {
      return { success: true }; // Already have an update
    }
    try {
      lastCheckTime = now;
      state = 'checking';
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err) {
      state = 'idle';
      return { success: false, error: String(err) };
    }
  }

  static async downloadUpdate(): Promise<IpcResponse<void>> {
    if (state !== 'available') {
      return { success: false, error: 'No update available to download' };
    }
    try {
      state = 'downloading';
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      state = 'available';
      return { success: false, error: String(err) };
    }
  }

  static async quitAndInstall(): Promise<IpcResponse<void>> {
    if (state !== 'ready') {
      return { success: false, error: 'No update ready to install' };
    }
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['Restart Now', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update Ready',
          message: 'A new version has been downloaded. Restart now to apply the update?',
        });
        if (response !== 0) {
          return { success: false, error: 'User cancelled' };
        }
      }
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  static cleanup(): void {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (initialCheckTimer) {
      clearTimeout(initialCheckTimer);
      initialCheckTimer = null;
    }
    autoUpdater.removeAllListeners();
    mainWindow = null;
  }
}
