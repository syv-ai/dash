import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ── Stderr EPIPE Guard ───────────────────────────────────────
process.stderr.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  throw err;
});

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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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

app.whenReady().then(async () => {
  // Initialize telemetry (before anything else, never throws)
  const { TelemetryService } = await import('./services/TelemetryService');
  TelemetryService.initialize();

  // Initialize database
  const { DatabaseService } = await import('./services/DatabaseService');
  await DatabaseService.initialize();

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

  // Kill PTYs owned by this window on close (CMD+W on macOS)
  mainWindow.on('close', () => {
    import('./services/ptyManager').then(({ killByOwner }) => {
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

  // Start pixel-agents watcher if configured
  const { PixelAgentsService } = await import('./services/PixelAgentsService');
  PixelAgentsService.setSender(mainWindow.webContents);
  const paConfig = PixelAgentsService.readConfig();
  if (paConfig?.name && paConfig.offices.some((o) => o.enabled)) {
    PixelAgentsService.start();
  }

  // Cleanup orphaned reserve worktrees (background, non-blocking)
  setTimeout(async () => {
    try {
      const { worktreePoolService } = await import('./services/WorktreePoolService');
      await worktreePoolService.cleanupOrphanedReserves();
    } catch {
      // Best effort
    }
  }, 2000);

  // Detect Claude CLI (cache for settings UI)
  detectClaudeCli();
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
    const claudePath = stdout.trim().split(/\r?\n/)[0].trim();
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

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const { createWindow } = await import('./window');
    mainWindow = createWindow();
    const { activityMonitor } = await import('./services/ActivityMonitor');
    activityMonitor.start(mainWindow.webContents);
    const { remoteControlService } = await import('./services/remoteControlService');
    remoteControlService.setSender(mainWindow.webContents);
    const { PixelAgentsService } = await import('./services/PixelAgentsService');
    PixelAgentsService.setSender(mainWindow.webContents);
    const { contextUsageService } = await import('./services/ContextUsageService');
    contextUsageService.setSender(mainWindow.webContents);

    // Update auto-updater window reference
    if (!process.argv.includes('--dev')) {
      const { AutoUpdateService } = await import('./services/AutoUpdateService');
      AutoUpdateService.setWindow(mainWindow);
    }
  }
});

app.on('before-quit', async () => {
  // Signal renderer to save all terminal snapshots before we kill PTYs
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('app:beforeQuit');
      }
    }
    // Give renderer a moment to save snapshots
    await new Promise((resolve) => setTimeout(resolve, 200));
  } catch {
    // Best effort
  }

  // Stop auto-updater
  try {
    const { AutoUpdateService } = await import('./services/AutoUpdateService');
    AutoUpdateService.cleanup();
  } catch {
    // Best effort
  }

  // Clean up hook settings from all settings.local.json files before stopping server
  try {
    const { cleanupHookSettings } = await import('./services/ptyManager');
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

  // Kill all PTYs (also stops activity monitor)
  try {
    const { killAll } = await import('./services/ptyManager');
    killAll();
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

  // Stop pixel-agents watcher
  try {
    const { PixelAgentsService } = await import('./services/PixelAgentsService');
    PixelAgentsService.stop();
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
});
