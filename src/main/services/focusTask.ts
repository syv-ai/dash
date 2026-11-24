import { app, BrowserWindow } from 'electron';
import type { PrProvider } from '@shared/types';

/**
 * Bring Dash's window to the front and send it `channel`. The caller is usually
 * another app's agent, so on macOS Dash takes focus from it. Returns false when
 * Dash has no window open.
 */
function sendToFront(channel: string, payload: unknown): boolean {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
  win.webContents.send(channel, payload);
  return true;
}

/**
 * Bring Dash's window to the front on a task (the control API's `tasks.open`).
 * The renderer selects the project and the task on `app:focusTask`.
 */
export function focusTaskInWindow(target: { taskId: string; projectId: string }): boolean {
  return sendToFront('app:focusTask', target);
}

/**
 * Bring Dash's window to the front on a task's diff editor, showing a PR (the
 * control API's `review.open`). The renderer selects the task and opens the PR
 * on `app:openPr`.
 */
export function openPrInWindow(target: {
  taskId: string;
  projectId: string;
  provider: PrProvider;
  number: number;
}): boolean {
  return sendToFront('app:openPr', target);
}
