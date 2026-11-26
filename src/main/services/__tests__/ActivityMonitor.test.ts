import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('util', () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: '' }) }));
vi.mock('electron', () => ({ default: {} }));

import {
  activityMonitor,
  activityEvents,
  SUBAGENT_QUIET_MS,
  TURN_SETTLE_MS,
  WAIT_LISTING_GRACE_MS,
} from '../ActivityMonitor';

const mockSender = {
  send: vi.fn(),
  isDestroyed: () => false,
};

beforeEach(() => {
  vi.useFakeTimers();
  // Inject sender directly without scheduling the safety valve interval —
  // tests that exercise the safety valve call activityMonitor.start() explicitly.
  (activityMonitor as unknown as { sender: typeof mockSender }).sender = mockSender;
  mockSender.send.mockClear();
});

afterEach(() => {
  activityMonitor.stop();
  const activities = (activityMonitor as unknown as { activities: Map<string, unknown> })
    .activities;
  for (const id of activities.keys()) {
    activityMonitor.unregister(id);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ActivityMonitor — state transitions (hooks-only)', () => {
  it('registers a PTY in idle state', () => {
    activityMonitor.register('pty1', 12345);
    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
  });

  it('setBusy transitions idle → busy synchronously (no debounce)', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    expect(activityMonitor.getAll()['pty1']!.state).toBe('busy');
  });

  it('setIdle transitions busy → idle', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    activityMonitor.setIdle('pty1');
    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
  });

  it('setWaitingForPermission transitions to waiting', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    activityMonitor.setWaitingForPermission('pty1');
    expect(activityMonitor.getAll()['pty1']!.state).toBe('waiting');
  });

  // H3, live: a background subagent's permission prompt shows in the main
  // pane (PermissionRequest carries its agent_id). The main turn's Stop
  // that followed flipped the task to busy while the prompt still waited.
  it("the main turn ending leaves a subagent's prompt waiting", () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    activityMonitor.subagentStart('pty1', 'a1');
    activityMonitor.setWaitingForPermission('pty1');
    activityMonitor.endTurn('pty1', ['a1']);
    expect(activityMonitor.getAll()['pty1']!.state).toBe('waiting');
  });

  // PermissionRequest sets waiting at once; the permission_prompt
  // notification for the same prompt follows ~6 s later.
  it('a second signal for the same wait does not emit again', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    activityMonitor.setWaitingForPermission('pty1');
    mockSender.send.mockClear();
    activityMonitor.setWaitingForPermission('pty1');
    expect(mockSender.send).not.toHaveBeenCalled();
  });

  it('resumeFromWait lifts a waiting task to busy once its prompt is answered', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    activityMonitor.setWaitingForPermission('pty1');
    activityMonitor.resumeFromWait('pty1');
    expect(activityMonitor.getAll()['pty1']!.state).toBe('busy');
  });

  it('resumeFromWait leaves a task that is not waiting alone', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.resumeFromWait('pty1');
    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
    activityMonitor.setError('pty1', { type: 'server_error' });
    activityMonitor.resumeFromWait('pty1');
    expect(activityMonitor.getAll()['pty1']!.state).toBe('error');
  });

  it('setError transitions to error and carries type + message', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setError('pty1', { type: 'rate_limit', message: 'Rate limited' });
    const info = activityMonitor.getAll()['pty1']!;
    expect(info.state).toBe('error');
    expect(info.error?.type).toBe('rate_limit');
    expect(info.error?.message).toBe('Rate limited');
  });

  it('setBusy clears prior error', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setError('pty1', { type: 'rate_limit' });
    activityMonitor.setBusy('pty1');
    const info = activityMonitor.getAll()['pty1']!;
    expect(info.state).toBe('busy');
    expect(info.error).toBeUndefined();
  });

  it('setIdle on an already-idle PTY does not emit', () => {
    activityMonitor.register('pty1', 12345);
    const before = mockSender.send.mock.calls.length;
    activityMonitor.setIdle('pty1');
    expect(mockSender.send.mock.calls.length).toBe(before);
  });
});

describe('ActivityMonitor — tool tracking', () => {
  it('setToolStart transitions to busy immediately and sets the tool label', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setToolStart('pty1', 'Bash', { command: 'ls -la' });
    const info = activityMonitor.getAll()['pty1']!;
    expect(info.state).toBe('busy');
    expect(info.tool?.toolName).toBe('Bash');
    expect(info.tool?.label).toBe('ls -la');
  });

  it('setToolEnd clears the tool but keeps state busy', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setToolStart('pty1', 'Bash', { command: 'ls' });
    activityMonitor.setToolEnd('pty1');
    const info = activityMonitor.getAll()['pty1']!;
    expect(info.state).toBe('busy');
    expect(info.tool).toBeUndefined();
  });

  it('setIdle clears tool', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setToolStart('pty1', 'Read', { file_path: '/foo/bar.ts' });
    activityMonitor.setIdle('pty1');
    expect(activityMonitor.getAll()['pty1']!.tool).toBeUndefined();
  });
});

describe('ActivityMonitor — compacting', () => {
  it('sets and clears compacting flag', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    activityMonitor.setCompacting('pty1', true);
    expect(activityMonitor.getAll()['pty1']!.compacting).toBe(true);
    activityMonitor.setCompacting('pty1', false);
    expect(activityMonitor.getAll()['pty1']!.compacting).toBeUndefined();
  });

  it('clears tool when compacting starts', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setToolStart('pty1', 'Bash', { command: 'ls' });
    activityMonitor.setCompacting('pty1', true);
    expect(activityMonitor.getAll()['pty1']!.tool).toBeUndefined();
  });

  it('setIdle clears compacting flag', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setCompacting('pty1', true);
    activityMonitor.setIdle('pty1');
    expect(activityMonitor.getAll()['pty1']!.compacting).toBeUndefined();
  });
});

describe('ActivityMonitor — safety valve', () => {
  // 5 minutes silent (no hooks AND no PTY output) → forced idle.
  // The interval ticks every 30s, so advancing by `5 min + 30 s` is enough
  // to guarantee at least one tick fires after the threshold is exceeded.
  const SAFETY_VALVE_TRIGGER_MS = 5 * 60_000 + 30_000;

  it('forces busy → idle after 5 minutes of silence', () => {
    activityMonitor.start(mockSender as unknown as Parameters<typeof activityMonitor.start>[0]);
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    expect(activityMonitor.getAll()['pty1']!.state).toBe('busy');

    vi.advanceTimersByTime(SAFETY_VALVE_TRIGGER_MS);

    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
  });

  it('forces waiting → idle after 5 minutes of silence', () => {
    activityMonitor.start(mockSender as unknown as Parameters<typeof activityMonitor.start>[0]);
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');
    activityMonitor.setWaitingForPermission('pty1');

    vi.advanceTimersByTime(SAFETY_VALVE_TRIGGER_MS);

    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
  });

  it('does not fire on idle PTYs', () => {
    activityMonitor.start(mockSender as unknown as Parameters<typeof activityMonitor.start>[0]);
    activityMonitor.register('pty1', 12345);
    vi.advanceTimersByTime(10 * 60_000);
    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
  });

  it('does not fire on error PTYs', () => {
    activityMonitor.start(mockSender as unknown as Parameters<typeof activityMonitor.start>[0]);
    activityMonitor.register('pty1', 12345);
    activityMonitor.setError('pty1', { type: 'rate_limit' });
    vi.advanceTimersByTime(10 * 60_000);
    expect(activityMonitor.getAll()['pty1']!.state).toBe('error');
  });

  it('noteData defers the safety valve', () => {
    activityMonitor.start(mockSender as unknown as Parameters<typeof activityMonitor.start>[0]);
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');

    // 4 minutes pass with periodic PTY output every minute
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(60_000);
      activityMonitor.noteData('pty1');
    }
    expect(activityMonitor.getAll()['pty1']!.state).toBe('busy');

    // Now go silent — needs another full safety-valve window from the last noteData
    vi.advanceTimersByTime(SAFETY_VALVE_TRIGGER_MS);
    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
  });

  it('a hook event defers the safety valve', () => {
    activityMonitor.start(mockSender as unknown as Parameters<typeof activityMonitor.start>[0]);
    activityMonitor.register('pty1', 12345);
    activityMonitor.setBusy('pty1');

    vi.advanceTimersByTime(4 * 60_000);
    activityMonitor.setToolStart('pty1', 'Bash', { command: 'sleep 1000' });
    vi.advanceTimersByTime(4 * 60_000);
    // Still busy — the tool-start reset the silence clock to t=4min,
    // and only 4 more minutes have passed since then
    expect(activityMonitor.getAll()['pty1']!.state).toBe('busy');

    vi.advanceTimersByTime(SAFETY_VALVE_TRIGGER_MS);
    expect(activityMonitor.getAll()['pty1']!.state).toBe('idle');
  });
});

describe('ActivityMonitor — getAll', () => {
  it('exposes registered PTYs', () => {
    activityMonitor.register('a', 1);
    activityMonitor.register('b', 2);
    const all = activityMonitor.getAll();
    expect(all['a']).toBeDefined();
    expect(all['b']).toBeDefined();
  });
});

describe('ActivityMonitor — supervisor reconcile (applySupervisor)', () => {
  const POLL = 15_000;

  it('creates the entry on first reconcile and applies the supervisor state', () => {
    activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
    expect(activityMonitor.has('t1')).toBe(true);
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
  });

  it('pushes a newly created entry to the renderer even when its state is the idle default', () => {
    // A task whose session is already idle when the listing first registers
    // it would otherwise never reach the renderer — no dot, no sleep button —
    // until its state changed (the renderer's initial fetch may predate it).
    activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
    expect(mockSender.send).toHaveBeenCalledWith(
      'pty:activity',
      expect.objectContaining({ t1: expect.objectContaining({ state: 'idle' }) }),
    );

    // Unchanged on the next poll: no redundant push.
    mockSender.send.mockClear();
    activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
    expect(mockSender.send).not.toHaveBeenCalled();
  });

  it('keeps a fresh hook-driven busy/idle reading for one poll interval', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setToolStart('t1', 'Bash', { command: 'ls' });
    activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
    expect(activityMonitor.getAll()['t1']!.tool?.toolName).toBe('Bash');

    vi.advanceTimersByTime(POLL + 1);
    activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
    expect(activityMonitor.getAll()['t1']!.tool).toBeUndefined();
  });

  it('applies stopped, waiting and error immediately, with detail', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    activityMonitor.applySupervisor('t1', { state: 'stopped', detail: 'Sleeping' }, POLL);
    let info = activityMonitor.getAll()['t1']!;
    expect(info.state).toBe('stopped');
    expect(info.detail).toBe('Sleeping');

    activityMonitor.applySupervisor('t1', { state: 'waiting', detail: 'input needed' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('waiting');

    activityMonitor.applySupervisor(
      't1',
      { state: 'error', error: { type: 'supervisor', message: 'crashed' } },
      POLL,
    );
    info = activityMonitor.getAll()['t1']!;
    expect(info.state).toBe('error');
    expect(info.error).toEqual({ type: 'supervisor', message: 'crashed' });
  });

  it('lifts a stopped task to busy even when a hook spoke recently', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.applySupervisor('t1', { state: 'stopped', detail: 'Sleeping' }, POLL);
    activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
    expect(activityMonitor.getAll()['t1']!.detail).toBeUndefined();
  });

  // The listing's `status` stays `busy` long after a turn ends (observed: ten
  // minutes at the prompt, and a `done` job for hours). Once a task's hooks
  // reach us they own the idle → busy transition; the listing may not undo a
  // Stop or an Escape interrupt after the freshness window closes.
  it('never promotes a hook-driven idle to busy, even after the freshness window', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    activityMonitor.setIdle('t1');
    vi.advanceTimersByTime(POLL + 1);
    activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
  });

  // S4, live: approving a permission prompt fires no hook until the tool
  // finishes, so the orb stayed purple while the command ran.
  it('lifts a waiting task to busy once the listing says the prompt was answered', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setToolStart('t1', 'Bash', { command: 'make' });
    activityMonitor.applySupervisor('t1', { state: 'waiting', detail: 'permission prompt' }, POLL);
    vi.advanceTimersByTime(POLL + 1);
    activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
  });

  // H3, live: denying a permission prompt is an interrupt and fires no
  // hook, so only the listing can say the wait is over. A hook spoke
  // seconds earlier (PermissionRequest, the permission_prompt notification),
  // which kept that reading out for a whole poll: a minute of false purple.
  describe('a wait the listing ends (H3)', () => {
    it('ends a hook-set wait when the listing says idle, though a hook just spoke', () => {
      activityMonitor.register('t1', 1);
      activityMonitor.setToolStart('t1', 'Bash', { command: 'touch x' });
      activityMonitor.setWaitingForPermission('t1');
      vi.advanceTimersByTime(WAIT_LISTING_GRACE_MS + 1);
      activityMonitor.setWaitingForPermission('t1'); // the ~6 s notification
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
    });

    it('lifts it to busy when the listing says the prompt was approved', () => {
      activityMonitor.register('t1', 1);
      activityMonitor.setToolStart('t1', 'Bash', { command: 'make' });
      activityMonitor.setWaitingForPermission('t1');
      vi.advanceTimersByTime(WAIT_LISTING_GRACE_MS + 1);
      activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
      expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
    });

    it('ignores a reading taken as the wait began: it may predate the prompt', () => {
      activityMonitor.register('t1', 1);
      activityMonitor.setToolStart('t1', 'Bash', { command: 'touch x' });
      activityMonitor.setWaitingForPermission('t1');
      vi.advanceTimersByTime(WAIT_LISTING_GRACE_MS - 1);
      activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
      expect(activityMonitor.getAll()['t1']!.state).toBe('waiting');
    });
  });

  // H5, live (2.1.332): denying a prompt ("No" by its number key, or by the
  // arrows and Enter) fires no hook, and only the listing ends the wait. The
  // user stopped the turn, so that idle is seen, as an interrupt is.
  describe('a wait the user denied (H5)', () => {
    function prompted(): void {
      activityMonitor.register('t1', 1);
      activityMonitor.setToolStart('t1', 'Bash', { command: 'date > /tmp/x' });
      activityMonitor.setWaitingForPermission('t1');
      vi.advanceTimersByTime(WAIT_LISTING_GRACE_MS + 1);
      activityMonitor.setWaitingForPermission('t1'); // the ~6 s notification
    }

    it('marks the idle the listing reports with no hook since the wait as interrupted', () => {
      prompted();
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(activityMonitor.getAll()['t1']).toEqual({ state: 'idle', interrupted: true });
    });

    it('still does when the listing read a stale busy in between', () => {
      prompted();
      activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
      vi.advanceTimersByTime(POLL + 1);
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(activityMonitor.getAll()['t1']!.interrupted).toBe(true);
    });

    it('an approved prompt whose tool ran ends as a finished turn', () => {
      prompted();
      activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
      activityMonitor.setToolEnd('t1');
      vi.advanceTimersByTime(POLL + 1);
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
    });

    it('an approved quick tool whose Stop lands before the listing is not interrupted', () => {
      prompted();
      activityMonitor.setToolEnd('t1');
      activityMonitor.endTurn('t1');
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
    });

    // "No, and tell Claude what to do differently" goes on with the turn:
    // its end is Claude's own.
    it('a deny with feedback that Claude acts on ends as a finished turn', () => {
      prompted();
      activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
      activityMonitor.endTurn('t1');
      vi.advanceTimersByTime(TURN_SETTLE_MS);
      expect(activityMonitor.getAll()['t1']).toEqual({ state: 'idle' });
    });

    it('a later turn ending on the listing is not interrupted', () => {
      prompted();
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      activityMonitor.setBusy('t1');
      vi.advanceTimersByTime(POLL + 1);
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
    });
  });

  // H1, live: the listing marks the job `failed` a second after StopFailure,
  // with no detail; the hook's error says why, so it stays.
  it("keeps a StopFailure's error when the listing reports the same failure", () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setError('t1', { type: 'unknown', message: 'API Error: 400 bad' });
    activityMonitor.applySupervisor('t1', { state: 'error', error: { type: 'supervisor' } }, POLL);
    expect(activityMonitor.getAll()['t1']!.error).toEqual({
      type: 'unknown',
      message: 'API Error: 400 bad',
    });
  });

  // H1, live: after a 401 StopFailure the listing read idle 1.6 s later and
  // the red was gone. The session sits at its prompt either way; the error
  // stands until the user's next turn.
  it("keeps a StopFailure's error over the listing's idle or busy", () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setError('t1', { type: 'authentication_failed' });
    vi.advanceTimersByTime(POLL + 1);
    activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
    activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('error');
    activityMonitor.setBusy('t1');
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
  });

  it("still lets a sleeping session's listing replace a StopFailure's error", () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setError('t1', { type: 'rate_limit' });
    activityMonitor.applySupervisor('t1', { state: 'stopped', detail: 'Sleeping' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('stopped');
  });

  it("takes the listing's error for a failure no hook reported", () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    vi.advanceTimersByTime(POLL + 1);
    activityMonitor.applySupervisor(
      't1',
      { state: 'error', error: { type: 'supervisor', message: 'exited' } },
      POLL,
    );
    expect(activityMonitor.getAll()['t1']!.error).toEqual({
      type: 'supervisor',
      message: 'exited',
    });
  });

  it('still drives busy for a listing-only task that has no hooks', () => {
    activityMonitor.applySupervisor('t2', { state: 'idle' }, POLL);
    activityMonitor.applySupervisor('t2', { state: 'busy' }, POLL);
    expect(activityMonitor.getAll()['t2']!.state).toBe('busy');
  });

  it('hooks clear the supervisor detail when they move the state', () => {
    activityMonitor.applySupervisor('t1', { state: 'stopped', detail: 'Sleeping' }, POLL);
    activityMonitor.setBusy('t1');
    expect(activityMonitor.getAll()['t1']!.detail).toBeUndefined();
  });

  it('a recent reconcile keeps the safety valve from forcing idle', () => {
    activityMonitor.start(mockSender as never);
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    vi.advanceTimersByTime(4 * 60_000);
    activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
    vi.advanceTimersByTime(2 * 60_000);
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
    vi.advanceTimersByTime(5 * 60_000);
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
  });
});

describe('ActivityMonitor — Escape interrupt (setInterrupted)', () => {
  const POLL = 15_000;

  it('brings a running task back to idle and clears the tool', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setToolStart('t1', 'Bash', { command: 'sleep 100' });
    activityMonitor.setInterrupted('t1');
    const info = activityMonitor.getAll()['t1']!;
    expect(info.state).toBe('idle');
    expect(info.tool).toBeUndefined();
  });

  it('also cancels a pending permission prompt', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setWaitingForPermission('t1');
    activityMonitor.setInterrupted('t1');
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
  });

  // H5, live (2.1.332): Ctrl+C leaves a permission prompt up; the task
  // went green for 1.2 s until the listing said waiting again.
  it('Ctrl+C leaves a pending prompt waiting', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setWaitingForPermission('t1');
    activityMonitor.setInterrupted('t1', 'ctrl-c');
    expect(activityMonitor.getAll()['t1']!.state).toBe('waiting');
  });

  it('is a no-op while idle — Escape there just closes menus', () => {
    activityMonitor.register('t1', 1);
    mockSender.send.mockClear();
    activityMonitor.setInterrupted('t1');
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
    expect(mockSender.send).not.toHaveBeenCalled();
  });

  it('does not touch stopped or errored tasks', () => {
    activityMonitor.applySupervisor('t1', { state: 'stopped', detail: 'Sleeping' }, POLL);
    activityMonitor.setInterrupted('t1');
    expect(activityMonitor.getAll()['t1']!.state).toBe('stopped');
  });

  // The supervisor's `status` goes stale (a `done` job has reported `busy`
  // for hours), so the keystroke must keep hook precedence: a listing that
  // still says busy right after the interrupt is ignored for one poll.
  it('keeps precedence over a stale busy from the supervisor for one poll', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    activityMonitor.setInterrupted('t1');
    activityMonitor.applySupervisor('t1', { state: 'busy' }, POLL);
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
  });

  it('lets the next hook re-establish busy as usual', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    activityMonitor.setInterrupted('t1');
    activityMonitor.setToolStart('t1', 'Read', { file_path: '/x' });
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
  });

  // The user stopped it: the renderer counts that end as seen (green), not
  // as a finished turn to flag (blue) or chime for.
  it('marks the idle it leaves as interrupted, until the next turn starts', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    activityMonitor.setInterrupted('t1');
    expect(activityMonitor.getAll()['t1']!.interrupted).toBe(true);
    activityMonitor.setBusy('t1');
    expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
    activityMonitor.setIdle('t1');
    expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
  });

  it('a turn that ends on its own is not interrupted', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    activityMonitor.setIdle('t1');
    expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
  });
});

describe('ActivityMonitor — background subagents (S3)', () => {
  const POLL = 15_000;
  const state = () => activityMonitor.getAll()['t1']!.state;

  /** A turn that launched two background subagents. */
  function launched(): void {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    activityMonitor.subagentStart('t1', 'a1');
    activityMonitor.subagentStart('t1', 'a2');
  }

  it('stays working when the main turn ends while subagents run', () => {
    launched();
    expect(activityMonitor.endTurn('t1', ['a1', 'a2'])).toBe(false);
    vi.advanceTimersByTime(TURN_SETTLE_MS * 2);
    expect(state()).toBe('busy');
    expect(activityMonitor.getAll()['t1']!.tool?.label).toBe('2 subagents running');
  });

  it('goes idle once the last subagent stops and Claude does not take a turn', () => {
    launched();
    activityMonitor.endTurn('t1', ['a1', 'a2']);
    activityMonitor.subagentStop('t1', 'a1');
    activityMonitor.subagentStop('t1', 'a2');
    expect(state()).toBe('busy');
    vi.advanceTimersByTime(TURN_SETTLE_MS);
    expect(state()).toBe('idle');
  });

  it("holds through the turn a subagent's report starts, without an idle flash", () => {
    launched();
    activityMonitor.endTurn('t1', ['a1', 'a2']);
    activityMonitor.subagentStop('t1', 'a1', ['a1', 'a2']);
    activityMonitor.subagentStop('t1', 'a2', ['a2']);
    mockSender.send.mockClear();
    vi.advanceTimersByTime(40);
    activityMonitor.setBusy('t1', { selfStarted: true });
    vi.advanceTimersByTime(TURN_SETTLE_MS * 2);
    const sent = mockSender.send.mock.calls.map(
      (c) => (c[1] as Record<string, { state: string }>)['t1']!.state,
    );
    expect(sent).not.toContain('idle');
    expect(activityMonitor.endTurn('t1', [])).toBe(true);
    vi.advanceTimersByTime(TURN_SETTLE_MS);
    expect(state()).toBe('idle');
  });

  it("takes the Stop hook's list of running subagents as the truth", () => {
    activityMonitor.register('t1', 1);
    activityMonitor.setBusy('t1');
    // Dash restarted mid-run: it never saw a1 start.
    activityMonitor.endTurn('t1', ['a1']);
    expect(state()).toBe('busy');
    // a SubagentStop lists itself as still running; the rest is the truth.
    activityMonitor.subagentStop('t1', 'a1', ['a1']);
    vi.advanceTimersByTime(TURN_SETTLE_MS);
    expect(state()).toBe('idle');
  });

  it('a subagent starting at rest (resumed) makes the task work', () => {
    activityMonitor.register('t1', 1);
    activityMonitor.subagentStart('t1', 'a1');
    expect(state()).toBe('busy');
  });

  describe('interrupts', () => {
    it('Esc mid-turn with subagents running stays working, then lands on seen idle', () => {
      launched();
      activityMonitor.setInterrupted('t1', 'escape');
      expect(state()).toBe('busy');
      activityMonitor.subagentStop('t1', 'a1');
      activityMonitor.subagentStop('t1', 'a2');
      vi.advanceTimersByTime(TURN_SETTLE_MS);
      expect(activityMonitor.getAll()['t1']).toEqual({ state: 'idle', interrupted: true });
    });

    it("keeps the interrupt through the reports' own turns; a typed prompt clears it", () => {
      launched();
      activityMonitor.setInterrupted('t1', 'ctrl-c');
      activityMonitor.subagentStop('t1', 'a1', ['a1', 'a2']);
      activityMonitor.setBusy('t1', { selfStarted: true });
      activityMonitor.endTurn('t1', ['a2']);
      activityMonitor.subagentStop('t1', 'a2', ['a2']);
      activityMonitor.setBusy('t1', { selfStarted: true });
      activityMonitor.endTurn('t1', []);
      vi.advanceTimersByTime(TURN_SETTLE_MS);
      expect(activityMonitor.getAll()['t1']!.interrupted).toBe(true);
      activityMonitor.setBusy('t1');
      activityMonitor.endTurn('t1', []);
      vi.advanceTimersByTime(TURN_SETTLE_MS);
      expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
    });

    it('Ctrl+C at the prompt stops the background subagents (no hook follows): seen idle', () => {
      launched();
      activityMonitor.endTurn('t1', ['a1', 'a2']);
      activityMonitor.setInterrupted('t1', 'ctrl-c');
      expect(activityMonitor.getAll()['t1']).toEqual({ state: 'idle', interrupted: true });
    });

    it('Esc at the prompt leaves running subagents alone', () => {
      launched();
      activityMonitor.endTurn('t1', ['a1', 'a2']);
      activityMonitor.setInterrupted('t1', 'escape');
      expect(state()).toBe('busy');
      expect(activityMonitor.getAll()['t1']!.interrupted).toBeUndefined();
    });
  });

  describe('missed stop events', () => {
    it('the session ending clears them', () => {
      launched();
      activityMonitor.setIdle('t1');
      expect(state()).toBe('idle');
      activityMonitor.setBusy('t1');
      activityMonitor.endTurn('t1');
      vi.advanceTimersByTime(TURN_SETTLE_MS);
      expect(state()).toBe('idle');
    });

    it('the session going to sleep clears them', () => {
      launched();
      activityMonitor.applySupervisor('t1', { state: 'stopped', detail: 'Sleeping' }, POLL);
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(state()).toBe('idle');
    });

    it("the listing's idle can't end them while they talk, but can once they've gone quiet", () => {
      launched();
      activityMonitor.endTurn('t1', ['a1', 'a2']);
      vi.advanceTimersByTime(POLL + 1);
      activityMonitor.noteSubagentHook('t1');
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(state()).toBe('busy');
      vi.advanceTimersByTime(SUBAGENT_QUIET_MS + 1);
      activityMonitor.applySupervisor('t1', { state: 'idle' }, POLL);
      expect(state()).toBe('idle');
    });
  });
});

describe('activityEvents', () => {
  it('emits the full map on every change, also with no renderer attached', () => {
    (activityMonitor as unknown as { sender: null }).sender = null;
    const seen: Array<Record<string, { state: string }>> = [];
    const onChange = (all: Record<string, { state: string }>) => seen.push(all);
    activityEvents.on('change', onChange);
    try {
      activityMonitor.register('t1', 1);
      activityMonitor.setBusy('t1');
      activityMonitor.setBusy('t1'); // no change, no event
      expect(seen.map((all) => all['t1']?.state)).toEqual(['idle', 'busy']);
    } finally {
      activityEvents.off('change', onChange);
    }
  });
});
