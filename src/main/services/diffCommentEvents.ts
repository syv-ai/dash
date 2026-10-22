import { BrowserWindow } from 'electron';

/**
 * "A task's diff comments changed outside the diff editor" (an agent drafted
 * one, or a submit posted some), sent to the renderer as `diffComments:changed`
 * so an open editor reloads them. The editor's own writes don't emit: its store
 * already holds them.
 */
export function emitDiffCommentsChanged(taskId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send('diffComments:changed', { taskId });
    } catch (err) {
      console.warn('[diffCommentEvents] broadcast failed', err);
    }
  }
}
