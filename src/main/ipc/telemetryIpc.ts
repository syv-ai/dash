import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs } from './validate';
import { TelemetryService } from '../services/TelemetryService';

// Events the renderer is allowed to send
const RENDERER_ALLOWED_EVENTS = new Set(['settings_changed']);

export function registerTelemetryIpc(): void {
  ipcMain.handle(
    'telemetry:capture',
    (_event, args: { event: string; properties?: Record<string, unknown> }) => {
      parseArgs(
        'telemetry:capture',
        z.looseObject({
          event: z.string(),
          properties: z.record(z.string(), z.unknown()).optional(),
        }),
        args,
      );
      if (!RENDERER_ALLOWED_EVENTS.has(args.event)) return;
      TelemetryService.capture(args.event, args.properties);
    },
  );

  ipcMain.handle('telemetry:getStatus', () => {
    return { success: true, data: TelemetryService.getStatus() };
  });

  ipcMain.handle('telemetry:setEnabled', (_event, enabled: boolean) => {
    parseArgs('telemetry:setEnabled', z.boolean(), enabled);
    TelemetryService.setEnabled(enabled);
    return { success: true, data: null };
  });
}
