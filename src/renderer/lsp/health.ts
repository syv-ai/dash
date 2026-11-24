import type { LspServerState, LspServerStatus } from '../../shared/lsp';

/*
 * A language server is worth showing only when it isn't healthy: running (or
 * stopped, which is a worktree closing) is quiet, and so is starting, for a
 * grace period. Past it, or restarting, failed or unavailable, it shows in
 * the editor and logs once per transition.
 */

/** How long a server may sit in `starting` before it counts as a problem. */
export const STARTING_GRACE_MS = 3000;

const UNHEALTHY: ReadonlySet<LspServerState> = new Set(['restarting', 'failed', 'unavailable']);

/** One server as last seen: its state, since when, and whether it showed. */
export interface TrackedServer {
  state: LspServerState;
  since: number;
  unhealthy: boolean;
}

/** A transition worth a console line. */
export interface HealthLog {
  level: 'warn' | 'info';
  status: LspServerStatus;
}

export interface HealthStep {
  /** Per server id, for the next step. */
  tracked: Map<string, TrackedServer>;
  /** The servers to show, in the order given. */
  unhealthy: LspServerStatus[];
  logs: HealthLog[];
  /** When a server still within its start grace runs out of it, or null. */
  recheckAt: number | null;
}

/**
 * The next health of one worktree's servers, from the last step's `tracked`
 * and the servers as they are at `now`. A server warns when it turns
 * unhealthy, or moves to another unhealthy state; it logs info when it
 * recovers to running. Calling it again with nothing changed logs nothing.
 */
export function stepHealth(
  prev: ReadonlyMap<string, TrackedServer>,
  servers: readonly LspServerStatus[],
  now: number,
  graceMs = STARTING_GRACE_MS,
): HealthStep {
  const tracked = new Map<string, TrackedServer>();
  const unhealthy: LspServerStatus[] = [];
  const logs: HealthLog[] = [];
  let recheckAt: number | null = null;

  for (const s of servers) {
    const before = prev.get(s.serverId);
    const since = before?.state === s.state ? before.since : now;
    const overdue = s.state === 'starting' && now - since >= graceMs;
    const bad = UNHEALTHY.has(s.state) || overdue;
    tracked.set(s.serverId, { state: s.state, since, unhealthy: bad });

    if (bad) {
      unhealthy.push(s);
      if (!before?.unhealthy || before.state !== s.state) logs.push({ level: 'warn', status: s });
    } else if (before?.unhealthy && s.state === 'running') {
      logs.push({ level: 'info', status: s });
    }
    if (s.state === 'starting' && !overdue) {
      const due = since + graceMs;
      recheckAt = recheckAt === null ? due : Math.min(recheckAt, due);
    }
  }
  return { tracked, unhealthy, logs, recheckAt };
}
