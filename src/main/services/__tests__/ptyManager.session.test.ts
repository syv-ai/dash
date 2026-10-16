import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Task } from '@shared/types';

const sup = vi.hoisted(() => {
  class DispatchError extends Error {
    constructor(
      message: string,
      readonly output: string,
    ) {
      super(message);
    }
  }
  return {
    DispatchError,
    find: vi.fn(
      async (_jobId: string): Promise<unknown> => ({ cwd: '/wt/t1', sessionId: 's1', pid: 7 }),
    ),
    dispatch: vi.fn(async (_opts: Record<string, unknown>) => ({
      jobId: 'job-new',
      sessionId: 'sess-new',
    })),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
});
vi.mock('../SupervisorService', () => ({
  DispatchError: sup.DispatchError,
  supervisorService: sup,
}));

const tasks = new Map<string, Task>();
const sessions: Array<[string, unknown]> = [];
vi.mock('../DatabaseService', () => ({
  DatabaseService: {
    getTask: (id: string) => tasks.get(id),
    setTaskSession: (id: string, s: Partial<Task>) => {
      sessions.push([id, s]);
      Object.assign(tasks.get(id) ?? {}, s);
    },
    markTaskSessionStopped: () => {},
    getTasksWithSessions: () => [],
  },
}));
vi.mock('../ptyHookSettings', () => ({
  writeHookSettings: () => ({ ok: true }),
  setCommitAttributionValue: () => {},
}));
vi.mock('../../control/mcpConfig', () => ({ mcpConfigForDispatch: () => undefined }));
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
  startDirectPty,
  sendRemoteControl,
  stopTaskSession,
  restartTaskSession,
  restartAndStartTaskSession,
  hasPty,
  __testReset,
  __setPtyModuleForTest,
} from '../ptyManager';
import { activityMonitor } from '../ActivityMonitor';

__setPtyModuleForTest({ spawn: ptySpawn });

function procs(): FakeProc[] {
  return spawned as FakeProc[];
}

beforeEach(() => {
  vi.useFakeTimers();
  __testReset();
  activityMonitor.unregister('t1');
  tasks.clear();
  sessions.length = 0;
  for (const fn of [sup.find, sup.dispatch, sup.stop]) fn.mockClear();
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

function fakeOwner() {
  return { send: vi.fn(), isDestroyed: () => false };
}

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

  it('stopTaskSession (archive, sleep) shows the pane Detached, not re-attaching', async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    await stopTaskSession('t1');
    expect(exitSends(owner)).toEqual([['pty:exit:t1', { exitCode: 0 }]]);
  });

  it('the pane restart path (restartTaskSession) sends a plain exit', async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    await restartTaskSession('t1');
    expect(exitSends(owner)).toEqual([['pty:exit:t1', { exitCode: 0 }]]);
  });

  it('restartAndStartTaskSession (API restart) re-dispatches and tells the pane to re-attach', async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    let stopped!: () => void;
    sup.stop.mockImplementationOnce(() => new Promise<void>((r) => (stopped = r)));
    const restarted = restartAndStartTaskSession('t1');
    await flush();
    expect(exitSends(owner)).toEqual([['pty:exit:t1', { exitCode: 0, reattach: true }]]);
    // The pane answers the exit at once; its start waits for the restart's.
    const reattach = startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    await flush();
    expect(ptySpawn).toHaveBeenCalledTimes(1);
    stopped();
    expect(await restarted).toEqual({ jobId: 'job-new' });
    await reattach;
    expect(sup.stop).toHaveBeenCalledWith('job-1');
    expect(sup.dispatch).toHaveBeenCalledTimes(1);
    expect(ptySpawn.mock.calls.at(-1)![1]).toEqual(['attach', 'job-new']);
  });

  it('a pane re-attaching over its own client gets no exit', async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    expect(exitSends(owner)).toHaveLength(0);
  });
});
