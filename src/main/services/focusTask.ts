import { app, BrowserWindow } from 'electron';
import type { ShowFileRequest } from '../../shared/showFile';

/**
 * Bring Dash's window to the front on a task (the control API's `tasks.open`).
 * The caller is usually another app's agent, so on macOS Dash takes focus from
 * it. The renderer selects the project and the task on `app:focusTask`.
 * Returns false when Dash has no window open.
 */
export function focusTaskInWindow(target: { taskId: string; projectId: string }): boolean {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
  win.webContents.send('app:focusTask', target);
  return true;
}

/**
 * Show a file in a task's editor (the control API's `show`): the renderer
 * opens it on `app:showFile`, at once when the task is the one open, else
 * when the person next opens it. Dash doesn't take focus: the caller is the
 * task's own agent, whose person is usually in Dash already.
 * Returns false when Dash has no window open.
 */
export function showInWindow(request: ShowFileRequest): boolean {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) return false;
  win.webContents.send('app:showFile', request);
  return true;
}
