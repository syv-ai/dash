import type { IpcResponse } from '../../shared/types';

/** A renderer error for PostHog error tracking; main scrubs and throttles it. */
export interface RendererErrorReport {
  /** `window` (error event), `unhandledrejection`, `react-uncaught`, `react-caught`. */
  source: 'window' | 'unhandledrejection' | 'react-uncaught' | 'react-caught';
  name: string;
  message: string;
  stack?: string;
}

/** PostHog telemetry capture and opt-in/out. */
export interface TelemetryApi {
  telemetryCapture: (event: string, properties?: Record<string, unknown>) => Promise<void>;
  telemetryException: (report: RendererErrorReport) => Promise<void>;
  telemetryGetStatus: () => Promise<IpcResponse<{ enabled: boolean; envDisabled: boolean }>>;
  telemetrySetEnabled: (enabled: boolean) => Promise<IpcResponse<void>>;
}
