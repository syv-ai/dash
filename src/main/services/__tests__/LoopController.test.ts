import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityInfo, LoopConfig, Task } from '@shared/types';

// The controller reaches ptyManager / LoopService / DatabaseService / ActivityMonitor
// as module singletons; mock them so this exercises the wiring (seed → manager →
// scheduler start, worker-idle advance, stop teardown) without Electron or a shell.
vi.mock('electron', () => ({ default: {} }));

vi.mock('../ptyManager', () => ({
  startDirectPty: vi.fn(async () => ({ reattached: false, isDirectSpawn: true })),
  killPtyAwait: vi.fn(async () => {}),
  getRecentOutput: vi.fn(() => ''),
}));

vi.mock('../LoopService', () => ({
  LoopService: {
    seed: vi.fn(async () => {}),
    appendRunLog: vi.fn(async () => {}),
    workerIterationPrompt: vi.fn(() => 'WORKER PROMPT'),
    managerPrompt: vi.fn(() => 'MANAGER PROMPT'),
  },
}));

vi.mock('../DatabaseService', () => ({
  DatabaseService: { getTask: vi.fn() },
}));

vi.mock('../ActivityMonitor', () => ({
  activityMonitor: { subscribe: vi.fn(() => vi.fn()) },
}));

// Only the port is read (for the manager's mcp-config URL) — stub it so the test
// stays isolated from the real hook server / DB.
vi.mock('../HookServer', () => ({ hookServer: { port: 5678 } }));

import { loopController } from '../LoopController';
import { startDirectPty, killPtyAwait } from '../ptyManager';
import { LoopService } from '../LoopService';
import { DatabaseService } from '../DatabaseService';
import { activityMonitor } from '../ActivityMonitor';

const flush = () => new Promise((r) => setTimeout(r, 0));

function loopTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'Refactor auth',
    path: '/wt/t1',
    taskKind: 'loop',
    loopConfig: { policy: 'ralph', goal: 'do the thing', level: 'L2' } as LoopConfig,
    ...overrides,
  } as Task;
}

/** Ids passed to startDirectPty, in call order. */
function spawnedIds(): string[] {
  return vi.mocked(startDirectPty).mock.calls.map((c) => c[0].id);
}

/** The options of the nth startDirectPty call. */
function spawnArg(i: number) {
  const call = vi.mocked(startDirectPty).mock.calls[i];
  if (!call) throw new Error(`no startDirectPty call at index ${i}`);
  return call[0];
}

/** The activity callback the controller registered, to drive busy→idle edges. */
function activityCb(): (all: Record<string, ActivityInfo>) => void {
  const call = vi.mocked(activityMonitor.subscribe).mock.calls[0];
  if (!call) throw new Error('activityMonitor.subscribe was not called');
  return call[0];
}

describe('LoopController', () => {
  const send = vi.fn();
  beforeEach(async () => {
    await loopController.stopAll();
    vi.clearAllMocks();
    loopController.setWebContentsProvider(() => ({ send, isDestroyed: () => false }) as never);
    vi.mocked(DatabaseService.getTask).mockReturnValue(loopTask());
  });

  it('seeds the spine, spawns the manager, then starts worker iteration 1', async () => {
    await loopController.start('t1');

    expect(LoopService.seed).toHaveBeenCalledWith('/wt/t1', 'Refactor auth', expect.anything());
    // Manager spawned before the worker; worker carries the iteration prompt.
    expect(spawnedIds()).toEqual(['mgr:t1', 'loop:t1']);
    const workerCall = spawnArg(1);
    expect(workerCall.freshContext).toBe(true);
    expect(workerCall.initialPrompt).toBe('WORKER PROMPT');
    expect(loopController.isRunning('t1')).toBe(true);
  });

  it('carries the manager write-deny settings on the manager spawn only', async () => {
    await loopController.start('t1');
    const mgrCall = spawnArg(0);
    const workerCall = spawnArg(1);
    expect(mgrCall.extraSettings).toMatchObject({ permissions: { deny: expect.any(Array) } });
    expect(workerCall.extraSettings).toBeUndefined();
  });

  it('attaches the loop MCP bridge to the manager only', async () => {
    await loopController.start('t1');
    const mgrCall = spawnArg(0);
    const workerCall = spawnArg(1);
    expect(mgrCall.mcpConfig).toContain('dash-loop');
    expect(mgrCall.mcpConfig).toContain('http://127.0.0.1:5678/mcp/loop?taskId=t1');
    expect(workerCall.mcpConfig).toBeUndefined();
  });

  it('advances to a fresh worker on a busy→idle edge (Ralph reset)', async () => {
    await loopController.start('t1');
    const cb = activityCb();

    cb({ 'loop:t1': { state: 'busy' } });
    cb({ 'loop:t1': { state: 'idle' } });
    await flush();

    // ralph with no stopPredicate → not done → kill + respawn the worker.
    expect(killPtyAwait).toHaveBeenCalledWith('loop:t1');
    expect(spawnedIds().filter((id) => id === 'loop:t1').length).toBe(2);
  });

  it('ignores the idle emitted at registration (before any work)', async () => {
    await loopController.start('t1');
    const cb = activityCb();
    cb({ 'loop:t1': { state: 'idle' } });
    await flush();
    // No busy seen yet → no reset.
    expect(killPtyAwait).not.toHaveBeenCalled();
    expect(spawnedIds().filter((id) => id === 'loop:t1').length).toBe(1);
  });

  it('pushes status to the renderer on start', async () => {
    await loopController.start('t1');
    expect(send).toHaveBeenCalledWith('loop:status', expect.objectContaining({ taskId: 't1' }));
  });

  it('stop kills the manager, unsubscribes, and forgets the loop', async () => {
    const unsub = vi.fn();
    vi.mocked(activityMonitor.subscribe).mockReturnValue(unsub);
    await loopController.start('t1');

    await loopController.stop('t1');

    expect(unsub).toHaveBeenCalled();
    expect(killPtyAwait).toHaveBeenCalledWith('mgr:t1');
    expect(loopController.isRunning('t1')).toBe(false);
  });

  it('is a no-op when the loop is already running', async () => {
    await loopController.start('t1');
    vi.mocked(startDirectPty).mockClear();
    await loopController.start('t1');
    expect(startDirectPty).not.toHaveBeenCalled();
  });

  it('throws for a task that is not a loop', async () => {
    vi.mocked(DatabaseService.getTask).mockReturnValue(loopTask({ taskKind: 'standard' }));
    await expect(loopController.start('t1')).rejects.toThrow(/not a loop/);
  });

  it('throws when the task is missing', async () => {
    vi.mocked(DatabaseService.getTask).mockReturnValue(undefined);
    await expect(loopController.start('t1')).rejects.toThrow(/not found/);
  });
});
