import * as fs from 'fs';

/**
 * Append-only debug log for the ports onboarding flow. Writes to a single,
 * fixed POSIX path (NOT os.tmpdir(), which on macOS resolves to a per-user
 * /var/folders/... dir that differs between Electron and the shell making
 * it impossible to find from a separate process).
 *
 * Path: `/tmp/dash-ports-debug.log`
 *
 * Each entry is one line:
 *   <ISO timestamp> [<tag>] <msg>
 *
 * Truncated on first call per process so each `pnpm dev` boot gets a fresh
 * file. Caller stamps a session-start marker via `portsDebug.boot()`.
 */
const LOG_PATH = '/tmp/dash-ports-debug.log';
let truncated = false;

function ensureFresh(): void {
  if (truncated) return;
  truncated = true;
  try {
    fs.writeFileSync(LOG_PATH, '');
  } catch {
    /* tmp dir not writable — silently degrade */
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const portsDebug = {
  path: LOG_PATH,

  boot(): void {
    ensureFresh();
    this.log('boot', `pid=${process.pid} time=${new Date().toISOString()}`);
  },

  log(tag: string, msg: string, extra?: Record<string, unknown>): void {
    ensureFresh();
    const stamp = new Date().toISOString();
    const extraStr = extra
      ? ' ' +
        Object.entries(extra)
          .map(([k, v]) => `${k}=${format(v)}`)
          .join(' ')
      : '';
    const line = `${stamp} [${tag}] ${msg}${extraStr}\n`;
    try {
      fs.appendFileSync(LOG_PATH, line);
    } catch {
      /* ignore */
    }
    // Also mirror to stderr so it shows up in the dev terminal like before.
    process.stderr.write(line);
  },
};
