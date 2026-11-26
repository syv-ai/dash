import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { app, powerMonitor } from 'electron';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { AutoUpdateStatus, IpcResponse } from '@shared/types';
import { initialStatus, reduce, shouldCheck, type UpdateEvent } from './autoUpdateState';
import { UpdateTelemetry } from './autoUpdateTelemetry';
import type { TelemetryEvent } from './activityTelemetry';
import { TelemetryService } from './TelemetryService';

/**
 * Wires electron-updater to Dash. Updates download on their own and install on
 * quit; the renderer gets the whole status on one channel and shows a
 * persistent banner, replacing the stack of never-dismissing toasts that made
 * the old flow unusable (#173).
 */

let mainWindow: BrowserWindow | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialCheckTimer: ReturnType<typeof setTimeout> | null = null;
let status: AutoUpdateStatus = initialStatus(false);
let listening = false;
let telemetry: UpdateTelemetry | null = null;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 10 * 1000; // 10 seconds
const LOG_MAX_BYTES = 512 * 1024;

function getPreferencePath(): string {
  return join(app.getPath('userData'), 'update-preferences.json');
}

function getLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'updater.log');
}

/** Append one line to <userData>/logs/updater.log, trimming it when it grows. */
function writeLog(level: string, message: string): void {
  try {
    const path = getLogPath();
    mkdirSync(join(app.getPath('userData'), 'logs'), { recursive: true });
    if (existsSync(path) && statSync(path).size > LOG_MAX_BYTES) {
      // Keep the tail: a support case cares about what happened most recently.
      const kept = readFileSync(path, 'utf-8').slice(-LOG_MAX_BYTES / 2);
      writeFileSync(path, kept, 'utf-8');
    }
    appendFileSync(path, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf-8');
  } catch {
    // Logging must never take the updater down.
  }
}

const fileLogger = {
  info: (m: unknown) => writeLog('info', String(m)),
  warn: (m: unknown) => writeLog('warn', String(m)),
  error: (m: unknown) => writeLog('error', String(m)),
  debug: (_m: unknown) => {
    // Dropped: electron-updater's debug stream is far too chatty for a log
    // the user may be asked to send us.
  },
};

/** Fold an updater event into the status and push the result to the renderer. */
function apply(event: UpdateEvent): void {
  status = reduce(status, event, Date.now());
  publish();
}

/** An update failure: reported (docs/telemetry.md) in the state it happened in, then folded in. */
function fail(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  send(telemetry?.failed(status.state, err, status.availableVersion));
  apply({ type: 'error', message });
  return message;
}

function send(event: TelemetryEvent | null | undefined): void {
  if (event) TelemetryService.capture(event.event, event.properties);
}

function publish(): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('autoUpdate:status', status);
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

const onWake = (): void => {
  void AutoUpdateService.checkForUpdates({ source: 'background' });
};

function startTimers(): void {
  clearTimers();
  initialCheckTimer = setTimeout(() => {
    initialCheckTimer = null;
    onWake();
  }, INITIAL_DELAY_MS);
  checkInterval = setInterval(onWake, CHECK_INTERVAL_MS);

  // A laptop that was shut for a week should notice on the way back, not four
  // hours later. Both are cheap: shouldCheck() holds them to the cooldown.
  if (!listening) {
    listening = true;
    app.on('browser-window-focus', onWake);
    try {
      powerMonitor.on('resume', onWake);
    } catch {
      // powerMonitor is unavailable before app ready / under tests.
    }
  }
}

function stopListening(): void {
  if (!listening) return;
  listening = false;
  app.removeListener('browser-window-focus', onWake);
  try {
    powerMonitor.removeListener('resume', onWake);
  } catch {
    // see startTimers()
  }
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
    status = initialStatus(true);
    telemetry = new UpdateTelemetry(app.getVersion());

    // Download without being asked, and apply on quit. Under 0.16.0 a restart
    // costs nothing: task sessions live under Claude Code's supervisor and
    // re-attach afterwards, so there is no work to lose.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = fileLogger;

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      writeLog('info', `update available: ${info.version}`);
      send(telemetry?.available(info.version));
      apply({
        type: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      });
    });

    autoUpdater.on('update-not-available', () => {
      apply({ type: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      apply({ type: 'progress', percent: progress.percent });
    });

    autoUpdater.on('update-downloaded', () => {
      writeLog('info', `update downloaded: ${status.availableVersion ?? 'unknown'}`);
      send(telemetry?.downloaded(status.availableVersion));
      apply({ type: 'downloaded' });
    });

    autoUpdater.on('error', (err: Error) => {
      writeLog('error', `during ${status.state}: ${err?.message || String(err)}`);
      fail(err);
    });

    if (AutoUpdateService.readPreference()) startTimers();
    publish();
  }

  static setWindow(window: BrowserWindow): void {
    mainWindow = window;
    // A reloaded renderer starts blank; hand it the current status at once so
    // a downloaded update doesn't go quiet until the next check.
    publish();
  }

  static getStatus(): IpcResponse<AutoUpdateStatus> {
    return { success: true, data: status };
  }

  static setEnabled(enabled: boolean): IpcResponse<void> {
    AutoUpdateService.writePreference(enabled);
    if (!status.initialized) {
      // Persist it anyway — the next packaged launch picks it up.
      return { success: true };
    }
    if (enabled) {
      if (mainWindow && !mainWindow.isDestroyed()) startTimers();
    } else {
      clearTimers();
      stopListening();
    }
    return { success: true };
  }

  static async checkForUpdates(
    opts: { source?: 'user' | 'background' } = {},
  ): Promise<IpcResponse<void>> {
    if (!status.initialized) {
      return { success: false, error: 'Auto-update not available in this build' };
    }
    const source = opts.source ?? 'user';
    if (!shouldCheck(status, source, Date.now())) {
      // Not an error: there is already an update in hand, or we checked a
      // moment ago. The renderer re-reads the status either way.
      return { success: true };
    }
    apply({ type: 'check-started' });
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err) {
      // `error` usually fires too, but not for every rejection.
      fail(err);
      return { success: false, error: String(err) };
    }
  }

  /** Manual retry after a failed auto-download. */
  static async downloadUpdate(): Promise<IpcResponse<void>> {
    if (!status.initialized) {
      return { success: false, error: 'Auto-update not available in this build' };
    }
    if (status.state !== 'available') {
      return { success: false, error: 'No update available to download' };
    }
    try {
      apply({ type: 'progress', percent: 0 });
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: fail(err) };
    }
  }

  static async quitAndInstall(): Promise<IpcResponse<void>> {
    if (!status.initialized) {
      return { success: false, error: 'Auto-update not available in this build' };
    }
    if (status.state !== 'ready') {
      return { success: false, error: 'No update ready to install' };
    }
    try {
      // No confirmation dialog: the user clicked "Restart to update", which is
      // the confirmation. The old extra prompt was pure friction.
      writeLog('info', `installing ${status.availableVersion ?? 'update'} and restarting`);
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (err) {
      return { success: false, error: fail(err) };
    }
  }

  static cleanup(): void {
    clearTimers();
    stopListening();
    autoUpdater.removeAllListeners();
    mainWindow = null;
    status = initialStatus(false);
  }
}
