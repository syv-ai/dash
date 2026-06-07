import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { app, dialog } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { IpcResponse } from '@shared/types';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';

export interface AutoUpdateStatus {
  state: UpdateState;
  availableVersion: string | null;
  /** False when the service hasn't been wired up (dev, Windows, or unsupported platforms). */
  initialized: boolean;
}

let mainWindow: BrowserWindow | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialCheckTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckTime = 0;
let state: UpdateState = 'idle';
let availableVersion: string | null = null;
let initialized = false;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 10 * 1000; // 10 seconds
const CHECK_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function getPreferencePath(): string {
  return join(app.getPath('userData'), 'update-preferences.json');
}

function send(channel: string, ...args: unknown[]): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch {
    // Best effort
  }
}

function clearTimers(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer);
    initialCheckTimer = null;
  }
}

function startTimers(): void {
  clearTimers();
  initialCheckTimer = setTimeout(() => {
    initialCheckTimer = null;
    // Route through the service so state/lastCheckTime stay coherent and
    // download/ready states aren't disturbed by a background check.
    AutoUpdateService.checkForUpdates({ source: 'background' }).catch(() => {});
  }, INITIAL_DELAY_MS);
  checkInterval = setInterval(() => {
    AutoUpdateService.checkForUpdates({ source: 'background' }).catch(() => {});
  }, CHECK_INTERVAL_MS);
}

export class AutoUpdateService {
  static readPreference(): boolean {
    try {
      const path = getPreferencePath();
      if (!existsSync(path)) return true;
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      return raw?.autoUpdateEnabled !== false;
    } catch {
      return true;
    }
  }

  static writePreference(enabled: boolean): void {
    try {
      writeFileSync(
        getPreferencePath(),
        JSON.stringify({ autoUpdateEnabled: enabled }, null, 2),
        'utf-8',
      );
    } catch (err) {
      console.error('[AutoUpdate] Failed to persist preference:', err);
    }
  }

  static initialize(window: BrowserWindow): void {
    autoUpdater.removeAllListeners();
    clearTimers();

    mainWindow = window;
    state = 'idle';
    availableVersion = null;
    initialized = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      state = 'available';
      availableVersion = info.version;
      send('autoUpdate:available', { version: info.version });
    });

    autoUpdater.on('update-not-available', () => {
      // Only reset if we were the ones who triggered the check. A periodic
      // background check that races against an in-progress download/ready
      // state must not wipe that state.
      if (state === 'checking') {
        state = 'idle';
        availableVersion = null;
        send('autoUpdate:notAvailable');
      }
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

    autoUpdater.on('error', (err: Error) => {
      const prevState = state;
      if (state === 'checking') state = 'idle';
      else if (state === 'downloading') state = 'available';
      console.error(`[AutoUpdate] Error during ${prevState}:`, err?.message || err);
      send('autoUpdate:error', {
        message: prevState === 'downloading' ? 'Download failed' : 'Update check failed',
        detail: err?.message || String(err),
      });
    });

    if (AutoUpdateService.readPreference()) {
      startTimers();
    }
  }

  static setWindow(window: BrowserWindow): void {
    mainWindow = window;
  }

  static getStatus(): IpcResponse<AutoUpdateStatus> {
    return {
      success: true,
      data: { state, availableVersion, initialized },
    };
  }

  static setEnabled(enabled: boolean): IpcResponse<void> {
    AutoUpdateService.writePreference(enabled);
    if (!initialized) {
      // Persist the preference but don't fail — the next packaged launch
      // will pick it up when initialize() runs.
      return { success: true };
    }
    if (enabled) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        startTimers();
      }
    } else {
      clearTimers();
    }
    return { success: true };
  }

  static async checkForUpdates(
    opts: { source?: 'user' | 'background' } = {},
  ): Promise<IpcResponse<void>> {
    if (!initialized) {
      return { success: false, error: 'Auto-update not available in this build' };
    }
    const source = opts.source ?? 'user';
    const now = Date.now();
    // Cooldown applies to background checks only. A user-initiated check
    // should always run — otherwise the UI sits at "Checking…" forever.
    if (source === 'background' && now - lastCheckTime < CHECK_COOLDOWN_MS) {
      return { success: true };
    }
    if (state === 'downloading' || state === 'ready') {
      // We already have an update in flight; treat as a no-op success so
      // the renderer can clear any optimistic "checking" UI immediately.
      return { success: true };
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
    if (!initialized) {
      return { success: false, error: 'Auto-update not available in this build' };
    }
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
    if (!initialized) {
      return { success: false, error: 'Auto-update not available in this build' };
    }
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
    clearTimers();
    autoUpdater.removeAllListeners();
    mainWindow = null;
    initialized = false;
  }
}
