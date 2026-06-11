import { BrowserWindow, Menu, shell } from 'electron';
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

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  return mainWindow;
}
