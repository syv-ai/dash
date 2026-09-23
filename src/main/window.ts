import { BrowserWindow, Menu, shell } from 'electron';
import * as path from 'path';

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
