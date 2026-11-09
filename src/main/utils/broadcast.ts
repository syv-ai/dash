import { BrowserWindow } from 'electron';

/**
 * Send an IPC event to every open renderer window. Skips destroyed windows and
 * never throws: a send that fails (a window torn down mid-loop) is logged and
 * the rest still get it. For a send to one specific window, use its
 * `webContents.send` directly.
 */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, ...args);
    } catch (err) {
      console.warn(`[broadcast] ${channel} send failed`, err);
    }
  }
}
