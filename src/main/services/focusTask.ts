import { app, BrowserWindow } from 'electron';

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
