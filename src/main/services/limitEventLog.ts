import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type { RateLimits } from '@shared/types';

/**
 * The evidence log for usage limits: every StopFailure and quota
 * Notification payload a task's hooks post, scrubbed, one JSON line each.
 * The docs don't say what a Pro/Max plan limit reports (their one
 * `rate_limit` example is a 429), so the next real hit shows it here,
 * beside the limits the statusLines last reported. Local only: nothing in
 * it is sent anywhere.
 */
export const LIMIT_LOG_FILE = 'claude-limits.jsonl';
/** What a full log rotates into (replaced on each rotation). */
export const LIMIT_LOG_ROTATED_FILE = 'claude-limits.1.jsonl';
const MAX_LOG_BYTES = 128 * 1024;
/** Longest string kept from a payload; error text is short, anything longer is content. */
const MAX_STRING = 400;
const MAX_DEPTH = 3;

/** Fields that name the user's files or folders: dropped, not scrubbed. */
const DROPPED = new Set(['cwd', 'transcript_path', 'scratchpad_dir', 'session_id', 'prompt_id']);

/**
 * A payload as the log keeps it: path fields dropped, the home folder in
 * any string written `~`, strings capped, nesting cut at MAX_DEPTH.
 */
export function scrubPayload(value: unknown, home = os.homedir(), depth = 0): unknown {
  if (typeof value === 'string') {
    const s = home ? value.split(home).join('~') : value;
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubPayload(v, home, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!DROPPED.has(k)) out[k] = scrubPayload(v, home, depth + 1);
  }
  return out;
}

export interface LimitEvent {
  /** The hook endpoint's event: `StopFailure` or `Notification`. */
  event: string;
  payload: Record<string, unknown>;
  claudeVersion: string;
  /** The account's limits as the statusLines last reported them. */
  rateLimits: RateLimits | undefined;
}

/** One log line for `e`, at `now`. */
export function limitEventLine(e: LimitEvent, now: Date, home = os.homedir()): string {
  return JSON.stringify({
    at: now.toISOString(),
    event: e.event,
    claudeVersion: e.claudeVersion,
    rateLimits: e.rateLimits ?? null,
    payload: scrubPayload(e.payload, home),
  });
}

function logDir(): string | null {
  try {
    return app.getPath('userData');
  } catch {
    return null; // No `app` (unit tests).
  }
}

/** Append `e` to the log, rotating it once it passes MAX_LOG_BYTES. Never throws. */
export function logLimitEvent(e: LimitEvent): void {
  const dir = logDir();
  if (!dir) return;
  try {
    const file = path.join(dir, LIMIT_LOG_FILE);
    const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    if (size > MAX_LOG_BYTES) fs.renameSync(file, path.join(dir, LIMIT_LOG_ROTATED_FILE));
    fs.appendFileSync(file, `${limitEventLine(e, new Date())}\n`);
  } catch (err) {
    console.warn('[limitEventLog] writing the log failed:', err);
  }
}
