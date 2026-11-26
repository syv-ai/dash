import { describe, it, expect } from 'vitest';
import type { Task } from '../../../../shared/types';
import type { AgentState } from '../../ui/StatusDot';
import type { TaskGroups, TaskStateRow } from '../taskStates';
import { taskTreeRows } from '../taskTree';

const row = (id: string, state: AgentState): TaskStateRow => ({
  task: { id, name: id, projectId: 'p' } as Task,
  state,
});
const groups = (over: Partial<TaskGroups> = {}): TaskGroups => ({
  favorites: [],
  news: [],
  resting: [],
  inactive: [],
  ...over,
});
const keys = (g: TaskGroups, open = false) => taskTreeRows(g, open).map((r) => r.key);

describe('taskTreeRows', () => {
  const all = groups({
    favorites: [row('f', 'asleep')],
    news: [row('w', 'work')],
    resting: [row('i', 'idle')],
    inactive: [row('s1', 'asleep'), row('s2', 'asleep')],
  });

  it('puts the favourites first, unheaded, gaps the groups, and folds the sleeping ones under a count', () => {
    expect(keys(all)).toEqual(['f', 'g:news', 'w', 'g:resting', 'i', 'g:inactive', 'inactive']);
    expect(taskTreeRows(all, false).at(-1)).toMatchObject({
      kind: 'inactive',
      count: 2,
      open: false,
    });
  });

  it('lists the sleeping tasks a level in once open', () => {
    const rows = taskTreeRows(all, true);
    expect(rows.slice(-3).map((r) => [r.key, r.depth])).toEqual([
      ['inactive', 0],
      ['s1', 1],
      ['s2', 1],
    ]);
  });

  it('leaves out empty groups and never starts with a gap', () => {
    expect(keys(groups({ inactive: [row('s', 'asleep')] }))).toEqual(['inactive']);
    expect(keys(groups({ resting: [row('i', 'idle')] }))).toEqual(['i']);
    expect(keys(groups())).toEqual([]);
  });

  it('lets the keys land on tasks and the inactive group only', () => {
    const focusable = taskTreeRows(all, true)
      .filter((r) => r.focusable)
      .map((r) => r.key);
    expect(focusable).toEqual(['f', 'w', 'i', 'inactive', 's1', 's2']);
  });
});
