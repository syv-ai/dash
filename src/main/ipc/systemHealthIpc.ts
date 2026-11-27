import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgsSafe } from './validate';
import { systemHealthService } from '../services/SystemHealthService';
import { MEMORY_WARNING_MAX_GB, MEMORY_WARNING_MIN_GB } from '@shared/systemHealth';

/** The memory warning's setting (Settings → Notifications), pushed on every change. */
export function registerSystemHealthIpc(): void {
  ipcMain.on('systemHealth:configure', (_event, config: unknown) => {
    const v = parseArgsSafe(
      'systemHealth:configure',
      z.object({
        enabled: z.boolean(),
        thresholdGb: z.number().min(MEMORY_WARNING_MIN_GB).max(MEMORY_WARNING_MAX_GB),
      }),
      config,
    );
    if (v) systemHealthService.configure(v);
  });
}
