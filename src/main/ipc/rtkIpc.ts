import { basename } from 'node:path';
import { ipcMain } from 'electron';
import { RtkService } from '../services/RtkService';
import { refreshActivePtyHooks, type RefreshFailure } from '../services/ptyManager';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarizeFailures(failures: RefreshFailure[]): string {
  const n = failures.length;
  const head = `${n} active task${n === 1 ? '' : 's'} didn't pick up the change`;
  const detail = failures
    .slice(0, 3)
    .map((f) => `${basename(f.settingsPath)}: ${f.error}`)
    .join('; ');
  const more = n > 3 ? ` (+${n - 3} more)` : '';
  return `${head} — ${detail}${more}`;
}

export function registerRtkIpc(): void {
  ipcMain.handle('rtk:getStatus', async () => {
    try {
      return { success: true, data: await RtkService.getStatus() };
    } catch (error) {
      console.error('[rtk:getStatus]', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('rtk:setEnabled', async (_event, enabled: boolean) => {
    try {
      // RtkService.setEnabled throws "rtk is not installed" if no binary is
      // resolved; we surface it via the IPC error envelope. The wire-type
      // (RtkStatus) makes "enabled while not installed" unrepresentable, so
      // a redundant pre-flight check would only widen the race window.
      RtkService.setEnabled(enabled);
      const { failures } = refreshActivePtyHooks();
      // Flag persisted to disk either way. When refresh partially failed,
      // return success (don't roll back the toggle — the state IS saved)
      // with a `warning` so the renderer can surface the partial state.
      if (failures.length > 0) {
        return { success: true, data: { warning: `Saved, but ${summarizeFailures(failures)}` } };
      }
      return { success: true, data: {} };
    } catch (error) {
      console.error('[rtk:setEnabled]', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('rtk:download', async () => {
    try {
      await RtkService.download();
      // Refresh hook JSON in active PTYs so a download while the toggle is
      // already on starts rewriting immediately. Failures are surfaced via
      // a `warning` field (matching rtk:setEnabled): the install itself
      // succeeded, but the user has running tasks that won't pick up the
      // new hook until they restart, and they should know.
      const { failures } = refreshActivePtyHooks();
      if (failures.length > 0) {
        return {
          success: true,
          data: {
            warning: `Installed. ${summarizeFailures(failures)} — restart those tasks to start compressing.`,
          },
        };
      }
      return { success: true, data: undefined };
    } catch (error) {
      console.error('[rtk:download]', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('rtk:test', async () => {
    try {
      return { success: true, data: await RtkService.runHookTest() };
    } catch (error) {
      console.error('[rtk:test]', error);
      return { success: false, error: errorMessage(error) };
    }
  });
}
