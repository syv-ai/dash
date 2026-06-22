import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('util', () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: '' }) }));
vi.mock('electron', () => ({ default: {} }));

import { activityMonitor } from '../ActivityMonitor';

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
