import { BrowserWindow } from 'electron';

/**
 * "The project list changed" in main (a project the control API added), for
 * the renderer (`projects:changed`), which reloads its list. Like
 * `tasks:changed` (taskEvents.ts); the renderer's own project edits reload
 * themselves.
 */
export function broadcastProjectsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send('projects:changed');
    } catch (err) {
      console.warn('[projectEvents] broadcast failed', err);
    }
  }
}
