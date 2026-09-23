// Ports setup as a small state machine (replaces the onboarding and setup
// wizards). It holds only setup progress; "configured" vs "not configured" is
// read from the worktree, not stored. Pure: effects are returned, not run.

export type Setup =
  /** Source task, right after "Start setup": the setup task is being created. */
  | { kind: 'creating' }
  /** Source task: the setup task exists; the agent is working there. */
  | { kind: 'started'; setupTaskId: string }
  /** Source task: creating the setup task failed. */
  | { kind: 'create-failed'; message: string }
  /** Setup task: waiting for the agent to write .dash/ports.json. */
  | { kind: 'waiting'; since: number; errors?: string[] }
  /** Setup task: ports.json landed and ports are allocated. */
  | { kind: 'allocated'; count: number }
  /** Setup task: no valid ports.json within the time limit. */
  | { kind: 'timed-out' };

export type SetupEvent =
  | { type: 'start' }
  | { type: 'created'; setupTaskId: string }
  | { type: 'createFailed'; message: string }
  | { type: 'setupTaskBorn'; now: number }
  | { type: 'config'; count: number }
  | { type: 'configError'; errors: string[] }
  | { type: 'tick'; now: number }
  | { type: 'restart' }
  | { type: 'dismiss' };

export type SetupEffect = 'createSetupTask' | 'restartSessions' | 'toastAllocated';

export const SETUP_TIMEOUT_MS = 30 * 60_000;

export function next(
  s: Setup | null,
  ev: SetupEvent,
): { setup: Setup | null; effects: SetupEffect[] } {
  const same = { setup: s, effects: [] as SetupEffect[] };
  switch (ev.type) {
    case 'start':
      // From idle, or to retry after a failed create.
      if (s === null || s.kind === 'create-failed') {
        return { setup: { kind: 'creating' }, effects: ['createSetupTask'] };
      }
      return same;
    case 'created':
      return s?.kind === 'creating'
        ? { setup: { kind: 'started', setupTaskId: ev.setupTaskId }, effects: [] }
        : same;
    case 'createFailed':
      return s?.kind === 'creating'
        ? { setup: { kind: 'create-failed', message: ev.message }, effects: [] }
        : same;
    case 'setupTaskBorn':
      return { setup: { kind: 'waiting', since: ev.now }, effects: [] };
    case 'config':
      return s?.kind === 'waiting'
        ? { setup: { kind: 'allocated', count: ev.count }, effects: ['toastAllocated'] }
        : same;
    case 'configError':
      return s?.kind === 'waiting' ? { setup: { ...s, errors: ev.errors }, effects: [] } : same;
    case 'tick':
      return s?.kind === 'waiting' && ev.now - s.since > SETUP_TIMEOUT_MS
        ? { setup: { kind: 'timed-out' }, effects: [] }
        : same;
    case 'restart':
      return s?.kind === 'allocated' ? { setup: null, effects: ['restartSessions'] } : same;
    case 'dismiss':
      return s &&
        (s.kind === 'started' ||
          s.kind === 'create-failed' ||
          s.kind === 'allocated' ||
          s.kind === 'timed-out')
        ? { setup: null, effects: [] }
        : same;
  }
}
