import { BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { getTuiHost } from './tui/hostInstance';
import { applyZoom } from './zoom';

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

  // One step in by default, or the user's level (zoom.ts).
  applyZoom(mainWindow);

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
