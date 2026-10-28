import { app, BrowserWindow, Menu, powerMonitor, shell } from 'electron';
import * as path from 'path';
import { getTuiHost } from './tui/hostInstance';

const isDev = process.argv.includes('--dev');

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    title: 'Dash',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'customButtonsOnHover' as const, frame: false }
      : {}),
    show: false,
  });

  // Remove the native menu bar entirely on Windows
  if (process.platform === 'win32') {
    mainWindow.setMenu(null);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Side-car TUIs can't survive a renderer reload — replaying clack output
  // into a fresh xterm breaks formatting. Tear them down (and clear the
  // session suppression set) so the fresh renderer re-offers anything still
  // relevant. Fires on the initial load too, where it's a no-op.
  mainWindow.webContents.on('did-navigate', () => {
    void getTuiHost().handleRendererReload();
  });

  watchForBlankWindow(mainWindow);

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  if (isDev) {
    // DASH_DEV_URL lets a second dev instance point at a Vite server on another
    // port (Vite picks the next free one when 3000 is taken).
    void mainWindow.loadURL(process.env.DASH_DEV_URL || 'http://localhost:3000');
    // DevTools is opened on demand (Cmd+Opt+I) rather than auto-opened — an
    // auto-opened DevTools frontend spams the terminal with Chromium's
    // "Autofill.enable wasn't found" CDP error on every boot.
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  return mainWindow;
}

/**
 * After a suspend (Linux Wayland, seen on amdgpu) the window can come back
 * white while every process is alive: a new frame alone does not fix it, so
 * unmap and remap the window to get it a fresh surface. Done on wake, again on
 * the first focus after it (the lock screen may have been up at wake), and
 * when the GPU process restarts; reload if the renderer itself died.
 */
function watchForBlankWindow(win: BrowserWindow): void {
  const repaint = (why: string) => {
    if (win.isDestroyed()) return;
    console.log(`[window] remapping after ${why}`);
    // show() would also restore a minimized window; a new frame is all it gets.
    if (win.isVisible() && !win.isMinimized()) {
      const maximized = win.isMaximized();
      win.hide();
      win.show();
      if (maximized) win.maximize();
    }
    win.webContents.invalidate();
  };
  let repaintOnFocus = false;
  // Give the GPU process a moment to come back before asking for a frame.
  const onResume = () => {
    repaintOnFocus = true;
    setTimeout(() => repaint('resume'), 1000);
  };
  const onUnlock = () => repaint('unlock-screen');
  win.on('focus', () => {
    if (!repaintOnFocus) return;
    repaintOnFocus = false;
    repaint('first focus after resume');
  });
  const onChildGone = (_e: Electron.Event, details: Electron.Details) => {
    if (details.type !== 'GPU') return;
    console.error(`[window] GPU process gone (${details.reason}, exit ${details.exitCode})`);
    setTimeout(() => repaint('GPU process restart'), 1000);
  };

  powerMonitor.on('resume', onResume);
  powerMonitor.on('unlock-screen', onUnlock);
  app.on('child-process-gone', onChildGone);

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[window] renderer gone (${details.reason}, exit ${details.exitCode})`);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload();
  });

  win.on('closed', () => {
    powerMonitor.removeListener('resume', onResume);
    powerMonitor.removeListener('unlock-screen', onUnlock);
    app.removeListener('child-process-gone', onChildGone);
  });
}
