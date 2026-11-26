import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs } from './validate';
import { TelemetryService } from '../services/TelemetryService';

const rendererErrorSchema = z.object({
  source: z.enum(['window', 'unhandledrejection', 'react-uncaught', 'react-caught']),
  name: z.string().max(200),
  message: z.string().max(2_000),
  stack: z.string().max(16_000).optional(),
});

// Events the renderer is allowed to send (docs/telemetry.md).
const RENDERER_ALLOWED_EVENTS = new Set(['file_opened']);

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

  // A renderer error (src/renderer/lib/telemetry.ts): rebuilt as an Error so
  // posthog-node parses its stack; scrubbed and throttled in TelemetryService.
  ipcMain.handle('telemetry:exception', (_event, report: unknown) => {
    const r = rendererErrorSchema.safeParse(report);
    if (!r.success) return;
    const err = new Error(r.data.message);
    err.name = r.data.name;
    err.stack = r.data.stack ?? `${r.data.name}: ${r.data.message}`;
    TelemetryService.captureException(err, { source: `renderer:${r.data.source}` });
  });

  ipcMain.handle('telemetry:getStatus', () => {
    return { success: true, data: TelemetryService.getStatus() };
  });

  ipcMain.handle('telemetry:setEnabled', (_event, enabled: boolean) => {
    parseArgs('telemetry:setEnabled', z.boolean(), enabled);
    TelemetryService.setEnabled(enabled);
    return { success: true, data: null };
  });
}
