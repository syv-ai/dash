import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgsSafe } from './validate';
import { systemHealthService } from '../services/SystemHealthService';
import { MEMORY_WARNING_MAX_GB, MEMORY_WARNING_MIN_GB } from '@shared/systemHealth';

/** Settings → System health, pushed on every change; the health popover
 *  opening or closing (`live`), which samples faster while it is open; and
 *  the timeline it draws (`history`), asked for once as it opens. */
export function registerSystemHealthIpc(): void {
  ipcMain.on('systemHealth:configure', (_event, config: unknown) => {
    const v = parseArgsSafe(
      'systemHealth:configure',
      z.object({
        alerts: z.boolean(),
        indicator: z.boolean(),
        thresholdGb: z.number().min(MEMORY_WARNING_MIN_GB).max(MEMORY_WARNING_MAX_GB),
      }),
      config,
    );
    if (v) systemHealthService.configure(v);
  });
  ipcMain.handle('systemHealth:history', () => systemHealthService.historyPoints());
  ipcMain.on('systemHealth:live', (_event, live: unknown) => {
    const v = parseArgsSafe('systemHealth:live', z.boolean(), live);
    if (v !== undefined) systemHealthService.setLive(v);
  });
}
