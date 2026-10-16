import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Task } from '@shared/types';

const sup = vi.hoisted(() => ({
  find: vi.fn(async (_jobId: string): Promise<unknown> => ({ cwd: '/wt/t1', sessionId: 's1' })),
  dispatch: vi.fn(async () => ({ jobId: 'job-new', sessionId: 'sess-new' })),
  stop: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));
vi.mock('../SupervisorService', () => ({
  DispatchError: class extends Error {},
  supervisorService: sup,
}));

const tasks = new Map<string, Task>();
vi.mock('../DatabaseService', () => ({
  DatabaseService: {
    getTask: (id: string) => tasks.get(id),
    setTaskSession: () => {},
    markTaskSessionStopped: () => {},
    getTasksWithSessions: () => [],
  },
}));
vi.mock('../ptyHookSettings', () => ({
  writeHookSettings: () => ({ ok: true }),
  setCommitAttributionValue: () => {},
}));
vi.mock('../claudeCli', () => ({
  findClaudePath: async () => '/usr/local/bin/claude',
  findLatestSessionId: () => null,
  requireSupportedClaude: async () => {},
}));
vi.mock('../claudeEnv', () => ({
  buildClaudeEnv: () => ({ DASH_TEST: '1' }),
  setClaudeEnvVars: () => {},
  setSyncShellEnv: () => {},
  setUltracode: () => {},
}));

type FakeProc = {
  write: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  onData(cb: (d: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  emit(data: string): void;
  exit(): void;
};

function fakeProc(): FakeProc {
  const data = new Set<(d: string) => void>();
  const exits = new Set<(e: { exitCode: number; signal?: number }) => void>();
  const proc: FakeProc = {
    write: vi.fn(),
    kill: vi.fn(() => proc.exit()),
    resize: vi.fn(),
    onData(cb) {
      data.add(cb);
      return { dispose: () => data.delete(cb) };
    },
    onExit(cb) {
      exits.add(cb);
      return { dispose: () => exits.delete(cb) };
    },
    emit: (d) => [...data].forEach((cb) => cb(d)),
    exit: () => [...exits].forEach((cb) => cb({ exitCode: 0, signal: 1 })),
  };
  return proc;
}

const spawned: unknown[] = [];
const ptySpawn = vi.fn();

import {
  submitToAgent,
  startDirectPty,
  sendRemoteControl,
  stopTaskSession,
  restartTaskSession,
  hasPty,
  __testReset,
  __setPtyModuleForTest,
} from '../ptyManager';
import { activityMonitor } from '../ActivityMonitor';

__setPtyModuleForTest({ spawn: ptySpawn });

const PASTE = (s: string) => `\x1b[200~${s}\x1b[201~`;

function procs(): FakeProc[] {
  return spawned as FakeProc[];
}

beforeEach(() => {
  vi.useFakeTimers();
  __testReset();
  activityMonitor.unregister('t1');
  tasks.clear();
  spawned.length = 0;
  ptySpawn.mockReset();
  ptySpawn.mockImplementation(() => {
    const p = fakeProc();
    spawned.push(p);
    return p;
  });
  tasks.set('t1', {
    id: 't1',
    name: 'T1',
    path: '/wt/t1',
    permissionMode: 'default',
    model: 'default',
    previousPath: null,
    jobId: 'job-1',
    sessionId: 's1',
  } as Task);
});

afterEach(() => {
  __testReset();
  vi.useRealTimers();
});

/** Let the awaited session lookup and spawn run. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('submitToAgent', () => {
  it('spawns a hidden attach, waits for its output to settle, then pastes and submits', async () => {
    const done = submitToAgent('t1', 'line one\nline two');
    await flush();
    expect(ptySpawn).toHaveBeenCalledTimes(1);
    expect(ptySpawn.mock.calls[0]![1]).toEqual(['attach', 'job-1']);
    expect(ptySpawn.mock.calls[0]![2]).toMatchObject({ cols: 120, rows: 30 });
    const proc = procs()[0]!;

    proc.emit('repaint');
    await vi.advanceTimersByTimeAsync(400);
    proc.emit('more repaint');
    await vi.advanceTimersByTimeAsync(400);
    expect(proc.write).not.toHaveBeenCalled(); // still repainting

    await vi.advanceTimersByTimeAsync(100);
    expect(proc.write.mock.calls).toEqual([[PASTE('line one\nline two')]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(proc.write.mock.calls).toEqual([[PASTE('line one\nline two')], ['\r']]);
    await done;
  });

  it('submits after the 5 s backstop when the attach prints nothing', async () => {
    const done = submitToAgent('t1', 'hi');
    await flush();
    const proc = procs()[0]!;
    await vi.advanceTimersByTimeAsync(4_900);
    expect(proc.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(proc.write).toHaveBeenCalledWith(PASTE('hi'));
    await vi.advanceTimersByTimeAsync(100);
    await done;
  });

  it('uses the open pane attach and spawns nothing', async () => {
    await startDirectPty({ id: 't1', cols: 80, rows: 24 });
    expect(ptySpawn).toHaveBeenCalledTimes(1);
    const pane = procs()[0]!;
    const done = submitToAgent('t1', 'hi');
    await flush();
    expect(ptySpawn).toHaveBeenCalledTimes(1);
    expect(pane.write.mock.calls).toEqual([[PASTE('hi')]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(pane.write.mock.calls).toEqual([[PASTE('hi')], ['\r']]);
    await done;
    // The pane is never detached by the submit.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pane.kill).not.toHaveBeenCalled();
    expect(hasPty('t1')).toBe(true);
  });

  it('detaches the hidden attach 3 s after the submit', async () => {
    const done = submitToAgent('t1', 'hi');
    await flush();
    const proc = procs()[0]!;
    await vi.advanceTimersByTimeAsync(5_100);
    await done;
    await vi.advanceTimersByTimeAsync(2_900);
    expect(proc.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(hasPty('t1')).toBe(false);
  });

  it('leaves a pane attach alone when it replaced the hidden one before the timer', async () => {
    const done = submitToAgent('t1', 'hi');
    await flush();
    const hidden = procs()[0]!;
    await vi.advanceTimersByTimeAsync(5_100);
    await done;

    await startDirectPty({ id: 't1', cols: 80, rows: 24 });
    const pane = procs()[1]!;
    expect(hidden.kill).toHaveBeenCalledTimes(1); // the pane start replaced it

    await vi.advanceTimersByTimeAsync(5_000);
    expect(pane.kill).not.toHaveBeenCalled();
    expect(hasPty('t1')).toBe(true);
  });

  it('reuses a lingering hidden attach for a second submit and restarts its timer', async () => {
    const first = submitToAgent('t1', 'one');
    await flush();
    await vi.advanceTimersByTimeAsync(5_100);
    await first;
    await vi.advanceTimersByTimeAsync(2_000);
    const second = submitToAgent('t1', 'two');
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(ptySpawn).toHaveBeenCalledTimes(1);
    const proc = procs()[0]!;
    await vi.advanceTimersByTimeAsync(2_000); // past the first timer
    expect(proc.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('marks the task busy once the message is submitted', async () => {
    await startDirectPty({ id: 't1', cols: 80, rows: 24 });
    expect(activityMonitor.getAll()['t1']?.state).toBe('idle');
    const done = submitToAgent('t1', 'hi');
    await flush();
    expect(activityMonitor.getAll()['t1']?.state).toBe('idle'); // Enter not pressed yet
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(activityMonitor.getAll()['t1']?.state).toBe('busy');
  });

  it('strips paste markers from the text so it cannot end the paste early', async () => {
    await startDirectPty({ id: 't1', cols: 80, rows: 24 });
    const done = submitToAgent('t1', 'a\x1b[201~b\r\nc');
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(procs()[0]!.write.mock.calls[0]).toEqual([PASTE('ab\nc')]);
  });
});

describe('sendRemoteControl', () => {
  it('types /rc and submits it 100 ms later', async () => {
    await startDirectPty({ id: 't1', cols: 80, rows: 24 });
    const pane = procs()[0]!;
    sendRemoteControl('t1');
    expect(pane.write.mock.calls).toEqual([['/rc']]);
    await vi.advanceTimersByTimeAsync(100);
    expect(pane.write.mock.calls).toEqual([['/rc'], ['\r']]);
  });
});

describe('stopping or restarting the session under an open pane', () => {
  function fakeOwner() {
    return { send: vi.fn(), isDestroyed: () => false };
  }
  const exitSends = (owner: ReturnType<typeof fakeOwner>) =>
    owner.send.mock.calls.filter(([channel]) => channel === 'pty:exit:t1');

  it('restartTaskSession tells the pane its attach client is gone', async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    await restartTaskSession('t1');
    expect(exitSends(owner)).toHaveLength(1);
    expect(sup.stop).toHaveBeenCalledWith('job-1');
    expect(hasPty('t1')).toBe(false);
  });

  it('stopTaskSession tells the pane its attach client is gone', async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    await stopTaskSession('t1');
    expect(exitSends(owner)).toHaveLength(1);
  });

  it('a pane re-attaching over its own client gets no exit', async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    expect(exitSends(owner)).toHaveLength(0);
  });
});
