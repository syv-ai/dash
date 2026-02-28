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
  } else if (process.platform === 'win32') {
    // Windows: ensure Git for Windows is in PATH
    additions.push(
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files (x86)\\Git\\bin',
      'C:\\Program Files (x86)\\Git\\cmd',
    );
  } else if (process.platform === 'linux') {
    const home = os.homedir();
    additions.push(
      path.join(home, '.nvm/versions/node/*/bin'),
      path.join(home, '.npm-global/bin'),
      path.join(home, '.local/bin'),
      '/usr/local/bin',
    );
  }

  const separator = process.platform === 'win32' ? ';' : ':';
  const pathSet = new Set(currentPath.split(separator));
  for (const p of additions) {
    pathSet.add(p);
  }
  process.env.PATH = [...pathSet].join(separator);
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
  // Initialize database
  const { DatabaseService } = await import('./services/DatabaseService');
  await DatabaseService.initialize();

  // Start hook server (must be ready before any PTY spawns)
  const { hookServer } = await import('./services/HookServer');
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
  if (process.platform === 'win32') {
    // Windows: detect Claude CLI in WSL
    try {
      const { WslService } = await import('./services/WslService');
      const distro = await WslService.resolveDistribution();
      if (distro) {
        const result = await WslService.detectClaudeCli(distro);
        claudeCliCache = result;
      } else {
        claudeCliCache = { installed: false, version: null, path: null };
      }
    } catch {
      claudeCliCache = { installed: false, version: null, path: null };
    }
  } else {
    // macOS/Linux: detect Claude CLI directly
    try {
      const { stdout } = await execFileAsync('which', ['claude']);
      const claudePath = stdout.trim();
      const { stdout: versionOut } = await execFileAsync(claudePath, ['--version']);
      claudeCliCache = {
        installed: true,
        version: versionOut.trim(),
        path: claudePath,
      };
    } catch {
      claudeCliCache = { installed: false, version: null, path: null };
    }
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

  // Stop all file watchers
  try {
    const { stopAll } = await import('./services/FileWatcherService');
    stopAll();
  } catch {
    // Best effort
  }
});
