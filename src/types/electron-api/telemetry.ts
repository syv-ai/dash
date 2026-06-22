import type { IpcResponse } from '../../shared/types';

/** PostHog telemetry capture and opt-in/out. */
export interface TelemetryApi {
  telemetryCapture: (event: string, properties?: Record<string, unknown>) => Promise<void>;
  telemetryGetStatus: () => Promise<IpcResponse<{ enabled: boolean; envDisabled: boolean }>>;
  telemetrySetEnabled: (enabled: boolean) => Promise<IpcResponse<void>>;
}
