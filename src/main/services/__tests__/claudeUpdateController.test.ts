import { describe, it, expect, vi } from 'vitest';
import type { ActivityInfo, ClaudeUpdateState } from '@shared/types';
import { ClaudeUpdateController } from '../claudeUpdateController';

/** A controller over fake activity and a restart that resolves when told to. */
function setup() {
  let activity: Record<string, ActivityInfo> = {};
  const restarts: string[] = [];
  const gates: Array<() => void> = [];
  const states: ClaudeUpdateState[] = [];
  const controller = new ClaudeUpdateController({
    getActivity: () => activity,
    restartTask: (taskId) => {
      restarts.push(taskId);
      return new Promise<void>((resolve) => gates.push(resolve));
    },
    publish: (s) => states.push(s),
  });
  const setActivity = (next: Record<string, ActivityInfo>) => {
    activity = next;
    controller.onActivity();
  };
  /** Let the restart in flight finish, then let the loop take its next step. */
  const finishRestart = async () => {
    gates.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { controller, restarts, states, setActivity, finishRestart };
}

const busy: ActivityInfo = { state: 'busy' };
const idle: ActivityInfo = { state: 'idle' };

describe('ClaudeUpdateController', () => {
  it('publishes the installed version and the sessions behind it', () => {
    const { controller, states } = setup();
    controller.setInstalled('2.1.333 (Claude Code)');
    controller.setSessions([
      { taskId: 'a', version: '2.1.332' },
      { taskId: 'b', version: '2.1.333' },
    ]);
    expect(states.at(-1)).toEqual({
      installedVersion: '2.1.333',
      outdated: [{ taskId: 'a', version: '2.1.332' }],
      restart: { phase: 'none' },
    });
  });

  it('restarts every outdated session one at a time, busy or not, on "now"', async () => {
    const { controller, restarts, states, setActivity, finishRestart } = setup();
    setActivity({ a: busy, b: { state: 'waiting' } });
    controller.setInstalled('2.1.333');
    controller.setSessions([
      { taskId: 'a', version: '2.1.332' },
      { taskId: 'b', version: '2.1.330' },
    ]);
    controller.restart('now');
    expect(restarts).toEqual(['a']);
    expect(states.at(-1)!.restart).toEqual({ phase: 'restarting', done: 0, total: 2 });
    await finishRestart();
    expect(restarts).toEqual(['a', 'b']);
    await finishRestart();
    expect(states.at(-1)!.restart).toEqual({ phase: 'none' });
  });

  it('never restarts the same session twice in one request, even if it is still behind', async () => {
    const { controller, restarts, finishRestart } = setup();
    controller.setInstalled('2.1.333');
    controller.setSessions([{ taskId: 'a', version: '2.1.332' }]);
    controller.restart('now');
    await finishRestart();
    controller.setSessions([{ taskId: 'a', version: '2.1.332' }]);
    expect(restarts).toEqual(['a']);
    expect(controller.getState().restart).toEqual({ phase: 'none' });
  });

  it('on "when done", waits until no task anywhere is active, then restarts', async () => {
    const { controller, restarts, states, setActivity, finishRestart } = setup();
    setActivity({ a: idle, other: busy });
    controller.setInstalled('2.1.333');
    controller.setSessions([{ taskId: 'a', version: '2.1.332' }]);
    controller.restart('whenDone');
    expect(restarts).toEqual([]);
    expect(states.at(-1)!.restart).toEqual({ phase: 'waiting', activeTaskIds: ['other'] });

    setActivity({ a: idle, other: { state: 'waiting' } });
    expect(restarts).toEqual([]);

    setActivity({ a: idle, other: idle });
    expect(restarts).toEqual(['a']);
    await finishRestart();
    expect(states.at(-1)!.restart).toEqual({ phase: 'none' });
  });

  it('skips a session that starts working mid-restart and waits for it', async () => {
    const { controller, restarts, states, setActivity, finishRestart } = setup();
    setActivity({ a: idle, b: idle });
    controller.setInstalled('2.1.333');
    controller.setSessions([
      { taskId: 'a', version: '2.1.332' },
      { taskId: 'b', version: '2.1.332' },
    ]);
    controller.restart('whenDone');
    expect(restarts).toEqual(['a']);

    // b gets a prompt while a restarts.
    setActivity({ a: idle, b: busy });
    await finishRestart();
    expect(restarts).toEqual(['a']);
    expect(states.at(-1)!.restart).toEqual({ phase: 'waiting', activeTaskIds: ['b'] });

    setActivity({ a: idle, b: idle });
    expect(restarts).toEqual(['a', 'b']);
    await finishRestart();
    expect(states.at(-1)!.restart).toEqual({ phase: 'none' });
  });

  it('cancels a pending "when done"', () => {
    const { controller, restarts, states, setActivity } = setup();
    setActivity({ a: busy });
    controller.setInstalled('2.1.333');
    controller.setSessions([{ taskId: 'a', version: '2.1.332' }]);
    controller.restart('whenDone');
    controller.cancel();
    expect(states.at(-1)!.restart).toEqual({ phase: 'none' });
    setActivity({ a: idle });
    expect(restarts).toEqual([]);
  });

  it('switches a pending "when done" to restarting now', () => {
    const { controller, restarts, setActivity } = setup();
    setActivity({ a: busy });
    controller.setInstalled('2.1.333');
    controller.setSessions([{ taskId: 'a', version: '2.1.332' }]);
    controller.restart('whenDone');
    controller.restart('now');
    expect(restarts).toEqual(['a']);
  });

  it('a request ends by itself when the sessions catch up some other way', () => {
    const { controller, setActivity } = setup();
    setActivity({ a: busy });
    controller.setInstalled('2.1.333');
    controller.setSessions([{ taskId: 'a', version: '2.1.332' }]);
    controller.restart('whenDone');
    controller.setSessions([{ taskId: 'a', version: '2.1.333' }]);
    expect(controller.getState()).toEqual({
      installedVersion: '2.1.333',
      outdated: [],
      restart: { phase: 'none' },
    });
  });

  it('keeps going when one restart fails', async () => {
    const restarts: string[] = [];
    const failing = new ClaudeUpdateController({
      getActivity: () => ({}),
      restartTask: async (id) => {
        restarts.push(id);
        if (id === 'a') throw new Error('boom');
      },
      publish: () => {},
    });
    failing.setInstalled('2.1.333');
    failing.setSessions([
      { taskId: 'a', version: '2.1.332' },
      { taskId: 'b', version: '2.1.332' },
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    failing.restart('now');
    await vi.waitFor(() => expect(failing.getState().restart).toEqual({ phase: 'none' }));
    expect(restarts).toEqual(['a', 'b']);
  });
});
