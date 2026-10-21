import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'crypto';

/** How long the prompt waits for the person; `dashctl` waits a little longer. */
const ANSWER_TIMEOUT_MS = 90_000;

/**
 * Bring Dash's window to the front and ask, in the renderer, whether an agent
 * outside Dash may control it (`app:orchestratorAccessRequest`). Resolves true
 * on Allow; false on Deny, on no answer in time, and when Dash has no window.
 */
export function askInWindow(): Promise<boolean> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) return Promise.resolve(false);
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();

  const id = randomUUID();
  return new Promise((resolve) => {
    const finish = (allowed: boolean) => {
      clearTimeout(timer);
      ipcMain.removeListener('app:orchestratorAccessAnswer', onAnswer);
      resolve(allowed);
    };
    const onAnswer = (_event: unknown, answer: unknown) => {
      const a = answer as { id?: unknown; allowed?: unknown } | null;
      if (a?.id === id) finish(a.allowed === true);
    };
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send('app:orchestratorAccessRequestEnded', { id });
      finish(false);
    }, ANSWER_TIMEOUT_MS);
    ipcMain.on('app:orchestratorAccessAnswer', onAnswer);
    win.webContents.send('app:orchestratorAccessRequest', { id });
  });
}
