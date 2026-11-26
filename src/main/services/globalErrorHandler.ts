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

let installed = false;

/**
 * Log and report a single main-process error. Exported (and side-effect-light)
 * so it can be unit-tested directly without emitting real process events.
 * TelemetryService throttles duplicates and scrubs the report.
 */
export function reportMainProcessError(kind: ErrorKind, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  // Always log (stderr is EPIPE-guarded in main.ts).
  console.error(`[globalError] ${kind}:`, err);
  TelemetryService.captureException(err, { source: kind, severity: 'error' });
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
