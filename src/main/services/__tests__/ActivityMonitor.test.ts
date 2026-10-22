import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('util', () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: '' }) }));
vi.mock('electron', () => ({ default: {} }));

import { activityMonitor, activityEvents } from '../ActivityMonitor';

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

  it('setError transitions to error and carries type + message', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setError('pty1', 'rate_limit', 'Rate limited');
    const info = activityMonitor.getAll()['pty1']!;
    expect(info.state).toBe('error');
    expect(info.error?.type).toBe('rate_limit');
    expect(info.error?.message).toBe('Rate limited');
  });

  it('maps error types', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setError('pty1', 'authentication_failed');
    expect(activityMonitor.getAll()['pty1']!.error?.type).toBe('auth_error');
    activityMonitor.setError('pty1', 'billing_error');
    expect(activityMonitor.getAll()['pty1']!.error?.type).toBe('billing_error');
    activityMonitor.setError('pty1', 'something_else');
    expect(activityMonitor.getAll()['pty1']!.error?.type).toBe('unknown');
  });

  it('setBusy clears prior error', () => {
    activityMonitor.register('pty1', 12345);
    activityMonitor.setError('pty1', 'rate_limit');
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
    activityMonitor.setError('pty1', 'rate_limit');
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
