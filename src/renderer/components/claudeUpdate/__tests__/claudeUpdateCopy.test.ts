import { describe, it, expect } from 'vitest';
import type { ClaudeUpdateState } from '../../../../shared/types';
import { updateIndicator, interruptNote } from '../claudeUpdateCopy';

const base: ClaudeUpdateState = {
  installedVersion: '2.1.333',
  outdated: [
    { taskId: 'a', version: '2.1.332' },
    { taskId: 'b', version: '2.1.331' },
  ],
  restart: { phase: 'none' },
};

describe('updateIndicator', () => {
  it('is absent when every live session runs the installed version', () => {
    expect(updateIndicator(null)).toBeNull();
    expect(updateIndicator({ ...base, outdated: [] })).toBeNull();
  });

  it('offers the update while sessions lag behind', () => {
    expect(updateIndicator(base)).toEqual({
      kind: 'available',
      title: 'Claude Code 2.1.333 is installed',
      description: '2 tasks run an older version',
    });
    expect(updateIndicator({ ...base, outdated: [base.outdated[0]!] })!.description).toBe(
      '1 task runs an older version',
    );
  });

  it('says a pending "restart when done" is waiting, and for how many tasks', () => {
    expect(
      updateIndicator({ ...base, restart: { phase: 'waiting', activeTaskIds: ['x', 'y'] } }),
    ).toEqual({
      kind: 'waiting',
      title: 'Restart when done',
      description: 'Waiting for 2 busy tasks',
    });
    expect(
      updateIndicator({ ...base, restart: { phase: 'waiting', activeTaskIds: ['x'] } })!
        .description,
    ).toBe('Waiting for 1 busy task');
  });

  it('shows progress while restarting, even once nothing is outdated', () => {
    expect(
      updateIndicator({
        ...base,
        outdated: [],
        restart: { phase: 'restarting', done: 1, total: 3 },
      }),
    ).toEqual({ kind: 'restarting', title: 'Restarting sessions', description: '1 of 3 done' });
  });
});

describe('interruptNote', () => {
  it('says nothing when no outdated task is busy', () => {
    expect(interruptNote([])).toBeNull();
  });

  it('names one or two busy tasks and counts more', () => {
    expect(interruptNote(['api'])).toBe('api is busy and will be interrupted.');
    expect(interruptNote(['api', 'web'])).toBe('api and web are busy and will be interrupted.');
    expect(interruptNote(['api', 'web', 'cli'])).toBe('3 tasks are busy and will be interrupted.');
  });
});
