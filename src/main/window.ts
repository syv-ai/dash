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
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    show: false,
  });

  // Remove the native menu bar entirely on Windows
  if (process.platform === 'win32') {
    mainWindow.setMenu(null);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the default browser, but only for safe web/mail
  // schemes. Validating the scheme here stops a hostile link (e.g. from
  // previewed, agent-authored HTML) from handing an arbitrary `file:` or
  // custom-scheme URL to the OS via shell.openExternal.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
        shell.openExternal(url).catch(() => {});
      }
    } catch {
      // Malformed URL — ignore.
    }
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
