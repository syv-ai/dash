/**
 * Claude Code's session registry: one `<configDir>/sessions/<pid>.json` per
 * running session, which names its job id, status and messaging socket (the
 * address another session's SendMessage reaches it at). Read-only; the
 * `.key` files beside them are secrets and never opened. Entries are left
 * behind by sessions that died, so only one whose process is alive counts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { claudeConfigDir } from '../utils/claudePaths';

/** A registry file's fields Dash uses. */
export interface SessionEntry {
  pid: number;
  sessionId: string | null;
  jobId: string | null;
  messagingSocketPath: string | null;
  /** Claude Code's own word: `idle`, `busy`, … */
  status: string | null;
  updatedAt: number;
}

/** A session that runs now. `messagingSocketPath` is null when its socket is gone. */
export interface LiveSession {
  pid: number;
  sessionId: string | null;
  messagingSocketPath: string | null;
  status: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Parse one registry file; null for a malformed or partial one (no numeric pid). */
export function parseSessionEntry(raw: string): SessionEntry | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0) return null;
  return {
    pid: r.pid,
    sessionId: str(r.sessionId),
    jobId: str(r.jobId),
    messagingSocketPath: str(r.messagingSocketPath),
    status: str(r.status),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The live sessions under `configDir`, by job id. A job with several entries
 * (a crashed run's file left beside the new one) keeps the newest.
 */
export function readLiveSessions(configDir: string = claudeConfigDir()): Map<string, LiveSession> {
  const dir = path.join(configDir, 'sessions');
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return new Map();
  }
  const newest = new Map<string, SessionEntry>();
  for (const name of names) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue; // removed while listing
    }
    const entry = parseSessionEntry(raw);
    if (!entry?.jobId || !isAlive(entry.pid)) continue;
    const seen = newest.get(entry.jobId);
    if (!seen || entry.updatedAt > seen.updatedAt) newest.set(entry.jobId, entry);
  }
  const live = new Map<string, LiveSession>();
  for (const [jobId, e] of newest) {
    live.set(jobId, {
      pid: e.pid,
      sessionId: e.sessionId,
      messagingSocketPath:
        e.messagingSocketPath && fs.existsSync(e.messagingSocketPath)
          ? e.messagingSocketPath
          : null,
      status: e.status,
    });
  }
  return live;
}
