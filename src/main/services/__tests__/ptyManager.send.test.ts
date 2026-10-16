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
    sendToSession: vi.fn(async (_opts: Record<string, unknown>) => {}),
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
    setTaskSession: (id: string, s: unknown) => sessions.push([id, s]),
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
  sendToTaskSession,
  setInitialPrompt,
  startDirectPty,
  sendRemoteControl,
  stopTaskSession,
  restartTaskSession,
  hasPty,
  __testReset,
  __setPtyModuleForTest,
} from '../ptyManager';
import { SessionNotIdleError } from '../supervisorSession';
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
  for (const fn of [sup.find, sup.dispatch, sup.sendToSession, sup.stop]) fn.mockClear();
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

describe('sendToTaskSession', () => {
  it('wakes the existing job with the message and marks the task busy', async () => {
    activityMonitor.ensure('t1');
    expect(await sendToTaskSession('t1', 'go on')).toEqual({ sent: true });
    expect(sup.sendToSession).toHaveBeenCalledTimes(1);
    expect(sup.sendToSession.mock.calls[0]![0]).toMatchObject({
      jobId: 'job-1',
      sessionId: 's1',
      cwd: '/wt/t1',
      message: 'go on',
      env: { DASH_TEST: '1' },
      row: { cwd: '/wt/t1', sessionId: 's1', pid: 7 },
    });
    expect(sup.dispatch).not.toHaveBeenCalled();
    expect(activityMonitor.getAll()['t1']?.state).toBe('busy');
    expect(ptySpawn).not.toHaveBeenCalled(); // no attach client of its own
  });

  it("leaves an open pane to its client's exit, which shows it Detached", async () => {
    const owner = fakeOwner();
    await startDirectPty({ id: 't1', cols: 80, rows: 24, sender: owner as never });
    const pane = procs()[0]!;
    sup.sendToSession.mockImplementationOnce(async () => pane.exit()); // the stop ends it
    await sendToTaskSession('t1', 'go on');
    expect(pane.kill).not.toHaveBeenCalled();
    expect(owner.send.mock.calls.filter(([c]) => c === 'pty:exit:t1')).toHaveLength(1);
    expect(hasPty('t1')).toBe(false);
  });

  it('records a session id the task did not have', async () => {
    tasks.get('t1')!.sessionId = null;
    await sendToTaskSession('t1', 'hi');
    expect(sessions).toEqual([['t1', { jobId: 'job-1', sessionId: 's1' }]]);
  });

  it('dispatches a task with no job, the message as its first prompt after a stashed one', async () => {
    tasks.get('t1')!.jobId = null;
    setInitialPrompt('t1', 'Set things up.');
    await sendToTaskSession('t1', 'Then this.');
    expect(sup.sendToSession).not.toHaveBeenCalled();
    expect(sup.dispatch.mock.calls[0]![0]).toMatchObject({
      prompt: 'Set things up.\n\nThen this.',
      resumeSessionId: 's1',
    });
    expect(activityMonitor.getAll()['t1']?.state).toBe('busy');
  });

  it('re-dispatches with the message when the job is gone from the listing', async () => {
    sup.find.mockResolvedValueOnce(undefined);
    await sendToTaskSession('t1', 'hi');
    expect(sup.dispatch.mock.calls[0]![0]).toMatchObject({ prompt: 'hi', resumeSessionId: 's1' });
  });

  it('returns the trust root for an untrusted folder and keeps only the stashed prompt', async () => {
    tasks.get('t1')!.jobId = null;
    setInitialPrompt('t1', 'First.');
    sup.dispatch.mockRejectedValueOnce(
      new sup.DispatchError('x', 'Workspace not trusted. Run `claude` in /repo once to accept'),
    );
    expect(await sendToTaskSession('t1', 'Second.')).toEqual({ needsTrust: '/repo' });
    await sendToTaskSession('t1', 'Third.');
    expect(sup.dispatch.mock.calls[1]![0]).toMatchObject({ prompt: 'First.\n\nThird.' });
  });

  it('passes on a busy session from the supervisor without marking busy', async () => {
    activityMonitor.ensure('t1');
    sup.sendToSession.mockRejectedValueOnce(new SessionNotIdleError('waiting'));
    await expect(sendToTaskSession('t1', 'hi')).rejects.toBeInstanceOf(SessionNotIdleError);
    expect(activityMonitor.getAll()['t1']?.state).toBe('idle');
  });

  it('refuses a task already busy (a send just before) without touching the supervisor', async () => {
    activityMonitor.ensure('t1');
    activityMonitor.setBusy('t1');
    await expect(sendToTaskSession('t1', 'hi')).rejects.toEqual(new SessionNotIdleError('busy'));
    expect(sup.find).not.toHaveBeenCalled();
  });

  it('fails rather than guess when the listing is unavailable', async () => {
    sup.find.mockRejectedValueOnce(new Error('listing down'));
    await expect(sendToTaskSession('t1', 'hi')).rejects.toThrow('listing down');
    expect(sup.sendToSession).not.toHaveBeenCalled();
    expect(sup.dispatch).not.toHaveBeenCalled();
  });

  it('runs after a start in flight instead of joining it, and a pane start waits for it', async () => {
    let listed!: (row: unknown) => void;
    sup.find.mockImplementationOnce(() => new Promise((resolve) => (listed = resolve)));
    const pane = startDirectPty({ id: 't1', cols: 80, rows: 24 });
    await flush();
    const sent = sendToTaskSession('t1', 'hi');
    await flush();
    expect(sup.sendToSession).not.toHaveBeenCalled();
    listed({ cwd: '/wt/t1', sessionId: 's1', pid: 7 });
    await pane;
    await sent;
    expect(sup.sendToSession).toHaveBeenCalledTimes(1);

    let delivered!: () => void;
    sup.sendToSession.mockImplementationOnce(() => new Promise<void>((r) => (delivered = r)));
    activityMonitor.setIdle('t1');
    const second = sendToTaskSession('t1', 'more');
    await flush();
    const reattach = startDirectPty({ id: 't1', cols: 80, rows: 24 });
    await flush();
    expect(ptySpawn).toHaveBeenCalledTimes(1); // waiting on the send
    delivered();
    await second;
    await reattach;
    expect(ptySpawn).toHaveBeenCalledTimes(2);
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
