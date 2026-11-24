import { create } from 'zustand';
import type { LspServerStatus } from '../../shared/lsp';
import { useLspStatus } from '../stores/lspStatusStore';
import { stepHealth, type HealthStep, type TrackedServer } from './health';

interface LspHealthState {
  /** Per worktree path, the servers that aren't healthy (see `stepHealth`). */
  unhealthy: Record<string, LspServerStatus[]>;
}

export const useLspHealth = create<LspHealthState>(() => ({ unhealthy: {} }));

function log(worktree: string, { logs }: HealthStep): void {
  for (const { level, status } of logs) {
    console[level]('[lsp]', status.serverId, status.state, worktree, status.message ?? '');
  }
}

/**
 * Follow the status feed: keep `useLspHealth` current and log each server's
 * turn to unhealthy (and back). Once per window, beside the feed: a component
 * per editor would log the same transition once per editor.
 */
export function startLspHealthWatch(): () => void {
  const tracked = new Map<string, ReadonlyMap<string, TrackedServer>>();
  const timers = new Map<string, number>();

  const step = (worktree: string) => {
    const servers = useLspStatus.getState().byWorktree[worktree] ?? [];
    const next = stepHealth(tracked.get(worktree) ?? new Map(), servers, Date.now());
    tracked.set(worktree, next.tracked);
    log(worktree, next);
    // A server still within its start grace: look again when it runs out.
    window.clearTimeout(timers.get(worktree));
    if (next.recheckAt !== null) {
      timers.set(
        worktree,
        window.setTimeout(() => step(worktree), next.recheckAt - Date.now()),
      );
    }
    useLspHealth.setState((s) => ({ unhealthy: { ...s.unhealthy, [worktree]: next.unhealthy } }));
  };

  const unsubscribe = useLspStatus.subscribe((s, prev) => {
    for (const worktree of Object.keys(s.byWorktree)) {
      if (s.byWorktree[worktree] !== prev.byWorktree[worktree]) step(worktree);
    }
  });
  return () => {
    unsubscribe();
    for (const t of timers.values()) window.clearTimeout(t);
  };
}
