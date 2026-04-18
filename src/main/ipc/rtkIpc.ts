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
      if (enabled) {
        // Refuse to enable without a resolvable binary; otherwise the toggle
        // would show "on" while buildPreToolUseHooks silently omits the entry.
        const status = await RtkService.getStatus();
        if (!status.installed) {
          return { success: false, error: 'rtk is not installed' };
        }
      }
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
      // already on starts rewriting immediately. Failures here are informational:
      // the binary installed fine and next-task-spawn writes settings anew, so
      // the refresh is best-effort and we don't fail the download IPC.
      const { failures } = refreshActivePtyHooks();
      if (failures.length > 0) {
        console.warn(
          `[rtk:download] install succeeded but hook refresh failed for ${failures.length} task(s):`,
          failures,
        );
      }
      return { success: true };
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
