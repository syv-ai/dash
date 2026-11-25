import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import { nextZoomLevel, readZoomLevel, writeZoomLevel, type ZoomCommand } from './zoomLevel';

/*
 * The window's zoom, owned by Dash rather than Chromium: the app opens one
 * step in (Chromium's Cmd+"+", level 0.5, ≈ ×1.095), "Actual Size" returns
 * there rather than to level 0, and the user's level persists across
 * restarts in `<userData>/zoom.json`. Chromium's own per-host memory can't
 * tell "never zoomed" from "zoomed back to 0", so it isn't the store.
 */

const zoomFile = () => path.join(app.getPath('userData'), 'zoom.json');

let level: number | null = null;
const currentLevel = () => (level ??= readZoomLevel(zoomFile()));

/** Apply the level to a window now and after every load (a reload or a
 *  navigation would otherwise take Chromium's remembered level). */
export function applyZoom(window: BrowserWindow): void {
  const set = () => window.webContents.setZoomLevel(currentLevel());
  set();
  window.webContents.on('did-finish-load', set);
}

function zoom(command: ZoomCommand): void {
  level = nextZoomLevel(currentLevel(), command);
  writeZoomLevel(zoomFile(), level);
  for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomLevel(level);
}

/**
 * The app menu: Electron's default (app, File, Edit, View, Window) with View's
 * zoom items Dash's own, so Actual Size means the default above and every
 * change persists. Cmd+= (a US keyboard's "+") zooms in too, unlisted.
 */
export function installAppMenu(): void {
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom('reset') },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoom('in') },
      {
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+=',
        visible: false,
        acceleratorWorksWhenHidden: true,
        click: () => zoom('in'),
      },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom('out') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    view,
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
