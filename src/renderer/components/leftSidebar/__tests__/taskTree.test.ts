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
  sleeping: [],
  ...over,
});
const keys = (g: TaskGroups, open = false) => taskTreeRows(g, open).map((r) => r.key);

describe('taskTreeRows', () => {
  const all = groups({
    favorites: [row('f', 'asleep')],
    news: [row('w', 'work')],
    resting: [row('i', 'idle')],
    sleeping: [row('s1', 'asleep'), row('s2', 'asleep')],
  });

  it('puts the favourites first, unheaded and ungapped, gaps the other groups, and folds the sleeping ones under a count', () => {
    expect(keys(all)).toEqual(['f', 'w', 'g:resting', 'i', 'g:sleeping', 'sleeping']);
    expect(taskTreeRows(all, false).at(-1)).toMatchObject({
      kind: 'sleeping',
      count: 2,
      open: false,
    });
  });

  it('lists the sleeping tasks a level in once open', () => {
    const rows = taskTreeRows(all, true);
    expect(rows.slice(-3).map((r) => [r.key, r.depth])).toEqual([
      ['sleeping', 0],
      ['s1', 1],
      ['s2', 1],
    ]);
  });

  it('leaves out empty groups and never starts with a gap', () => {
    expect(keys(groups({ sleeping: [row('s', 'asleep')] }))).toEqual(['sleeping']);
    expect(keys(groups({ resting: [row('i', 'idle')] }))).toEqual(['i']);
    expect(keys(groups())).toEqual([]);
  });

  it('keeps the gap before the sleeping group after favourites alone', () => {
    const favs = groups({ favorites: [row('f', 'idle')], sleeping: [row('s', 'asleep')] });
    expect(keys(favs)).toEqual(['f', 'g:sleeping', 'sleeping']);
    expect(keys(groups({ favorites: [row('f', 'idle')], resting: [row('i', 'idle')] }))).toEqual([
      'f',
      'i',
    ]);
  });

  it('lets the keys land on tasks and the sleeping group only', () => {
    const focusable = taskTreeRows(all, true)
      .filter((r) => r.focusable)
      .map((r) => r.key);
    expect(focusable).toEqual(['f', 'w', 'i', 'sleeping', 's1', 's2']);
  });
});
