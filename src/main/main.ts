import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { installGlobalErrorHandlers } from './services/globalErrorHandler';

const execFileAsync = promisify(execFile);

// ── Stderr EPIPE Guard ───────────────────────────────────────
process.stderr.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  throw err;
});

// ── Global Error Handlers ────────────────────────────────────
// Last-resort uncaughtException / unhandledRejection handlers: log + report to
// telemetry, then keep running. Installed before anything else so startup
// errors are caught too (telemetry.capture no-ops until initialize() runs).
installGlobalErrorHandlers();

// ── PATH Fix ──────────────────────────────────────────────────
function fixPath(): void {
  const currentPath = process.env.PATH || '';
  const additions: string[] = [];

  if (process.platform === 'darwin') {
    const home = os.homedir();
    additions.push(
      path.join(home, '.local/bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    );
    // Try to get login shell PATH
    try {
      const { execSync } = require('child_process');
      const shellPath = execSync('zsh -ilc "echo $PATH"', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      if (shellPath) {
        additions.push(...shellPath.split(':'));
      }
    } catch {
      // Ignore — best effort
    }
  } else if (process.platform === 'linux') {
    const home = os.homedir();
    additions.push(
      path.join(home, '.nvm/versions/node/*/bin'),
      path.join(home, '.npm-global/bin'),
      path.join(home, '.local/bin'),
      '/usr/local/bin',
    );
  } else if (process.platform === 'win32') {
    // Common Node/npm install locations on Windows including nvm4w
    const home = os.homedir();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    additions.push(
      path.join(appData, 'npm'),
      path.join(localAppData, 'Programs', 'nodejs'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files\\Git\\usr\\bin',
    );
    // Version managers set env vars pointing to the active Node.js directory
    if (process.env.NVM_SYMLINK) additions.push(process.env.NVM_SYMLINK);
    if (process.env.NVM_HOME) additions.push(process.env.NVM_HOME);
    if (process.env.FNM_DIR) additions.push(path.join(process.env.FNM_DIR, 'aliases', 'default'));
    if (process.env.VOLTA_HOME) additions.push(path.join(process.env.VOLTA_HOME, 'bin'));
  }

  const pathSep = process.platform === 'win32' ? ';' : ':';
  const pathSet = new Set(currentPath.split(pathSep));
  for (const p of additions) {
    pathSet.add(p);
  }
  process.env.PATH = [...pathSet].join(pathSep);
}

fixPath();

// ── Single Instance Lock ──────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── App Ready ─────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

void app.whenReady().then(async () => {
  // Initialize telemetry (before anything else, never throws)
  const { TelemetryService } = await import('./services/TelemetryService');
  TelemetryService.initialize();

  // Initialize database
  const { DatabaseService } = await import('./services/DatabaseService');
  DatabaseService.initialize();

  // Start hook server (must be ready before any PTY spawns)
  const { hookServer } = await import('./services/HookServer');
  const { hasPty } = await import('./services/ptyManager');
  hookServer.setPtyValidator(hasPty);
  await hookServer.start();

  // Register IPC handlers
  const { registerAllIpc } = await import('./ipc');
  registerAllIpc();

  // Create main window
  const { createWindow } = await import('./window');
  mainWindow = createWindow();

  // Token stats: bind sender and kick off backfill asynchronously.
  const { tokenStatsService } = await import('./services/TokenStatsService');
  tokenStatsService.setSender(mainWindow.webContents);
  void tokenStatsService.backfillPending();

  // Kill PTYs owned by this window on close (CMD+W on macOS)
  mainWindow.on('close', () => {
    void import('./services/ptyManager').then(({ killByOwner }) => {
      killByOwner(mainWindow!.webContents);
    });
  });

  // Start activity monitor — must happen after window creation
  const { activityMonitor } = await import('./services/ActivityMonitor');
  activityMonitor.start(mainWindow.webContents);

  // Remote control service needs a sender for state change events
  const { remoteControlService } = await import('./services/remoteControlService');
  remoteControlService.setSender(mainWindow.webContents);

  // Start context usage service — broadcasts status line data to renderer
  const { contextUsageService } = await import('./services/ContextUsageService');
  contextUsageService.setSender(mainWindow.webContents);

  // Initialize auto-updater (production only, disabled on Windows custom builds)
  if (!process.argv.includes('--dev') && process.platform !== 'win32') {
    const { AutoUpdateService } = await import('./services/AutoUpdateService');
    AutoUpdateService.initialize(mainWindow);
  }

  // Resolve rtk synchronously at startup; getHookCommand() is called on PTY spawn.
  const { RtkService } = await import('./services/RtkService');
  RtkService.setSender(mainWindow.webContents);
  await RtkService.warmUp().catch((err) => {
    console.error('[RtkService.warmUp]', err);
  });

  // TUI feature IPC needs the main window for feature broadcasts (e.g.
  // ports:restart-task); register here (not in registerAllIpc) since that
  // path doesn't have a window yet.
  const { registerWizardIpc, cleanupWizardsAtBoot } = await import('./ipc/wizardIpc');
  const { registerPortsWizard, migrateLegacyPortsDismissals } = await import('./wizard/ports');
  registerPortsWizard();
  migrateLegacyPortsDismissals();
  cleanupWizardsAtBoot();
  registerWizardIpc({ getMainWindow: () => mainWindow });
  const { registerServicesIpc } = await import('./ipc/servicesIpc');
  registerServicesIpc();

  // Crash resilience: persist terminal mirrors every 60s (quit and kill
  // paths persist too — this only bounds what a hard crash can lose).
  setInterval(() => {
    void import('./services/ptyManager').then(({ persistAllMirrors }) => {
      persistAllMirrors();
    });
  }, 60_000);

  // Cleanup orphaned reserve worktrees (background, non-blocking)
  setTimeout(() => {
    void (async () => {
      try {
        const { worktreePoolService } = await import('./services/WorktreePoolService');
        await worktreePoolService.cleanupOrphanedReserves();
      } catch {
        // Best effort
      }
    })();
  }, 2000);

  // Detect Claude CLI (cache for settings UI)
  void detectClaudeCli();
});

// ── Claude CLI Detection ──────────────────────────────────────
export let claudeCliCache: { installed: boolean; version: string | null; path: string | null } = {
  installed: false,
  version: null,
  path: null,
};

async function detectClaudeCli(): Promise<void> {
  try {
    const findCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(findCmd, ['claude']);
    // where.exe may return multiple lines; take the first
    const claudePath = stdout.trim().split(/\r?\n/)[0]!.trim();
    // .cmd files on Windows must be invoked through cmd.exe
    const { stdout: versionOut } =
      process.platform === 'win32'
        ? await execFileAsync('cmd.exe', ['/c', claudePath, '--version'])
        : await execFileAsync(claudePath, ['--version']);
    claudeCliCache = {
      installed: true,
      version: versionOut.trim(),
      path: claudePath,
    };
  } catch {
    claudeCliCache = { installed: false, version: null, path: null };
  }
}

// ── App Lifecycle ─────────────────────────────────────────────
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  void (async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const { createWindow } = await import('./window');
      mainWindow = createWindow();
      const { activityMonitor } = await import('./services/ActivityMonitor');
      activityMonitor.start(mainWindow.webContents);
      const { remoteControlService } = await import('./services/remoteControlService');
      remoteControlService.setSender(mainWindow.webContents);
      const { RtkService } = await import('./services/RtkService');
      RtkService.setSender(mainWindow.webContents);
      const { contextUsageService } = await import('./services/ContextUsageService');
      contextUsageService.setSender(mainWindow.webContents);
      const { tokenStatsService } = await import('./services/TokenStatsService');
      tokenStatsService.setSender(mainWindow.webContents);

      // Update auto-updater window reference
      if (!process.argv.includes('--dev')) {
        const { AutoUpdateService } = await import('./services/AutoUpdateService');
        AutoUpdateService.setWindow(mainWindow);
      }
    }
  })();
});

// Set once cleanup has finished so the re-issued quit passes straight through.
let quitCleanupComplete = false;

app.on('before-quit', (event) => {
  // Second pass (after cleanup re-issues app.quit()): let the quit proceed.
  if (quitCleanupComplete) return;
  // Hold the quit so graceful PTY shutdown (killAll → SIGTERM → flush) can
  // complete — otherwise the app exits before Claude persists its session tail.
  event.preventDefault();

  // Hard safety net: never let a hung cleanup wedge the quit. app.exit bypasses
  // before-quit entirely and force-terminates.
  const forceExit = setTimeout(() => app.exit(0), 8000);

  void (async () => {
    // Terminal persistence happens main-side: killAll() below serializes every
    // PTY's TerminalMirror to the snapshot files before killing — the renderer
    // is no longer involved (no app:beforeQuit round-trip needed).

    // Stop auto-updater
    try {
      const { AutoUpdateService } = await import('./services/AutoUpdateService');
      AutoUpdateService.cleanup();
    } catch {
      // Best effort
    }

    // Clean up hook settings from all settings.local.json files before stopping server
    try {
      const { cleanupHookSettings } = await import('./services/ptyHookSettings');
      cleanupHookSettings();
    } catch {
      // Best effort
    }

    // Stop hook server
    try {
      const { hookServer } = await import('./services/HookServer');
      hookServer.stop();
    } catch {
      // Best effort
    }

    // Kill all PTYs (also stops activity monitor). Awaited so each Claude
    // child gets its SIGTERM flush window before the app exits.
    try {
      const { killAll } = await import('./services/ptyManager');
      await killAll();
    } catch {
      // Best effort
    }

    // Stop context usage service (clears debounce timer)
    try {
      const { contextUsageService } = await import('./services/ContextUsageService');
      contextUsageService.stop();
    } catch {
      // Best effort
    }

    // Stop all file watchers
    try {
      const { stopAll } = await import('./services/FileWatcherService');
      stopAll();
    } catch {
      // Best effort
    }

    // Stop all session watchers
    try {
      const { stopAll: stopSessionWatchers } = await import('./services/SessionWatcherService');
      stopSessionWatchers();
    } catch {
      // Best effort
    }

    // Stop all ports.json watchers
    try {
      const { stopAll: stopPortsConfigWatchers } = await import('./services/PortsConfigWatcher');
      stopPortsConfigWatchers();
    } catch {
      // Best effort
    }

    // Flush telemetry
    try {
      const { TelemetryService } = await import('./services/TelemetryService');
      await TelemetryService.shutdown();
    } catch {
      // Best effort
    }

    // Cleanup done — cancel the safety net and let the re-issued quit through.
    clearTimeout(forceExit);
    quitCleanupComplete = true;
    app.quit();
  })();
});
