import { TelemetryService } from './TelemetryService';

/**
 * Process-wide last-resort handlers for the main process. Without these, an
 * uncaught exception or an unhandled promise rejection takes down the whole app
 * (Node terminates on both by default in current versions) — killing every live
 * terminal session — and nothing is ever reported.
 *
 * Policy: log + report to telemetry, then KEEP RUNNING. This matches the app's
 * existing best-effort posture (the stderr EPIPE guard, telemetry-never-crashes,
 * 60s mirror persistence) and is the right call for a desktop dev tool where a
 * single stray rejection should not discard the user's worktrees and terminals.
 * Node's caveat that resuming after an uncaughtException is "unsafe" is
 * acknowledged and accepted here; the periodic mirror persistence bounds what a
 * genuinely corrupt state could lose.
 */

type ErrorKind = 'uncaughtException' | 'unhandledRejection';

// Throttle duplicate reports so a hot loop (e.g. a rejecting interval) can't
// flood telemetry or the console with the same error many times per second.
const DEDUPE_WINDOW_MS = 10_000;
const MAX_TRACKED = 100;
const recentReports = new Map<string, number>();

let installed = false;

/**
 * Log and report a single main-process error. Exported (and side-effect-light)
 * so it can be unit-tested directly without emitting real process events.
 */
export function reportMainProcessError(kind: ErrorKind, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const name = err.name || 'Error';
  const message = err.message || String(error);

  // Always log (stderr is EPIPE-guarded in main.ts).
  console.error(`[globalError] ${kind}:`, err);

  const key = `${kind}:${name}:${message}`;
  const now = Date.now();
  const last = recentReports.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
  if (recentReports.size >= MAX_TRACKED) recentReports.clear();
  recentReports.set(key, now);

  // TelemetryService.capture is self-guarding: it no-ops when telemetry is
  // disabled or not yet initialized, and sanitizes/truncates every property.
  TelemetryService.capture('$exception', {
    $exception_type: name,
    $exception_message: message,
    $exception_list: [{ type: name, value: message }],
    source: kind,
    severity: 'error',
  });
}

/** Install the process-wide handlers. Idempotent. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', (err) => reportMainProcessError('uncaughtException', err));
  process.on('unhandledRejection', (reason) =>
    reportMainProcessError('unhandledRejection', reason),
  );
}

/** Test-only: clear the dedupe window between cases. */
export function __resetErrorThrottleForTest(): void {
  recentReports.clear();
}
