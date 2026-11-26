/**
 * Renderer analytics: forwards an event to main, which owns the PostHog
 * client, the opt-out and the allowlist (telemetryIpc's renderer list,
 * docs/telemetry.md). Fire and forget; never throws.
 */
export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  try {
    void window.electronAPI.telemetryCapture(event, properties).catch(() => {});
  } catch {
    // No bridge (gallery, tests): nothing to send.
  }
}

type ErrorSource = Parameters<typeof window.electronAPI.telemetryException>[0]['source'];

/** Send a renderer error to main for PostHog error tracking (scrubbed and throttled there). */
export function reportError(source: ErrorSource, error: unknown): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    void window.electronAPI
      .telemetryException({ source, name: err.name, message: err.message, stack: err.stack })
      .catch(() => {});
  } catch {
    // No bridge: nothing to send.
  }
}

/** Report the renderer's uncaught errors and unhandled rejections. Call once at startup. */
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => reportError('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason));
}
