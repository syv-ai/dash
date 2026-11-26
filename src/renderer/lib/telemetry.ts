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
