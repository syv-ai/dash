/** A worktree setup script's run, keyed by the worktree path (setup starts
 *  before the task row exists, so the path is the one id both sides know). */
export type SetupRunStatus = 'running' | 'succeeded' | 'failed';

export interface SetupRun {
  worktreePath: string;
  status: SetupRunStatus;
  startedAt: number;
  endedAt: number | null;
  /** Why it failed, short enough for a toast; null unless `failed`. */
  error: string | null;
}

export interface SetupLog {
  text: string;
  /** Older output was dropped to stay under the cap. */
  trimmed: boolean;
}

/** Keep about the last 1 MB of a run's output. */
export const SETUP_LOG_CAP = 1_000_000;

/**
 * Append `chunk` to `log`, keeping it under `cap` characters. Once over, the
 * front is cut back to three quarters of the cap (so the copy happens every
 * so often, not on every chunk), at a line start when one is near.
 */
export function appendCapped(log: SetupLog, chunk: string, cap = SETUP_LOG_CAP): SetupLog {
  const text = log.text + chunk;
  if (text.length <= cap) return { text, trimmed: log.trimmed };
  let cut = text.length - Math.floor(cap * 0.75);
  const nl = text.indexOf('\n', cut);
  if (nl !== -1 && nl - cut < 4096) cut = nl + 1;
  return { text: text.slice(cut), trimmed: true };
}

// CSI (colours, cursor moves) and OSC (titles, links) escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Plain text for the log view: escape codes removed, CRLF folded to LF. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '').replace(/\r\n/g, '\n');
}

/** The toast-sized reason a run failed. */
export function setupFailureMessage(args: {
  log: string;
  code: number | null;
  timedOut: boolean;
  timeoutMs: number;
}): string {
  if (args.timedOut) {
    return `timed out after ${args.timeoutMs / 60_000} min (scripts must not stay in the foreground)`;
  }
  const lines = stripAnsi(args.log)
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  const exit = args.code === null ? 'was killed' : `exited with code ${args.code}`;
  return last ? `${last.slice(0, 180)} (${exit})` : exit;
}
