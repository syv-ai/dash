import { describe, it, expect } from 'vitest';
import type { Task } from '../../../../shared/types';
import type { AgentState } from '../../ui/StatusDot';
import { IDLE_LIMIT, type TaskStateRow } from '../taskStates';
import { taskTreeRows } from '../taskTree';

const row = (id: string, state: AgentState): TaskStateRow => ({
  task: { id, name: id, projectId: 'p' } as Task,
  state,
});
const idle = (n: number) => Array.from({ length: n }, (_, i) => row(`i${i}`, 'idle'));

describe('taskTreeRows', () => {
  it('lists the active rows, a gap, then the idle ones', () => {
    const rows = taskTreeRows({ active: [row('w', 'work')], idle: idle(2) }, false, null);
    expect(rows.map((r) => r.key)).toEqual(['w', 'gap', 'i0', 'i1']);
  });

  it('draws no gap when either side is empty', () => {
    expect(taskTreeRows({ active: [row('w', 'work')], idle: [] }, false, null)).toHaveLength(1);
    expect(taskTreeRows({ active: [], idle: idle(1) }, false, null)).toHaveLength(1);
  });

  it('caps the idle rows with More, and Less once shown', () => {
    const list = { active: [], idle: idle(IDLE_LIMIT + 2) };
    const capped = taskTreeRows(list, false, null);
    expect(capped).toHaveLength(IDLE_LIMIT + 1);
    expect(capped.at(-1)).toMatchObject({ kind: 'more', expanded: false, hidden: 2 });
    const all = taskTreeRows(list, true, null);
    expect(all).toHaveLength(IDLE_LIMIT + 3);
    expect(all.at(-1)).toMatchObject({ kind: 'more', expanded: true, hidden: 0 });
  });

  it('makes every task and More focusable, never the gap', () => {
    const rows = taskTreeRows({ active: [row('w', 'work')], idle: idle(1) }, false, null);
    expect(rows.map((r) => r.focusable)).toEqual([true, false, true]);
  });
});
