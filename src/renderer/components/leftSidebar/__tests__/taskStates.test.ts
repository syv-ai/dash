import { describe, it, expect } from 'vitest';
import type { ActivityInfo, Project, Task } from '../../../../shared/types';
import {
  IDLE_LIMIT,
  agentState,
  failureReason,
  liveRows,
  newTaskProjectId,
  orderTasksByState,
  visibleIdleRows,
} from '../taskStates';

const project = (id: string) => ({ id, name: `Project ${id}` }) as Project;
const task = (id: string, updatedAt: string, extra: Partial<Task> = {}) =>
  ({ id, name: id, projectId: 'p', updatedAt, archivedAt: null, ...extra }) as Task;

const ids = (rows: { task: Task }[]) => rows.map((r) => r.task.id);

describe('agentState', () => {
  it('maps activity onto the agent states', () => {
    expect(agentState({ state: 'waiting' }, false)).toBe('needs');
    expect(agentState({ state: 'error' }, false)).toBe('fail');
    expect(agentState({ state: 'busy' }, true)).toBe('work');
    expect(agentState({ state: 'idle' }, true)).toBe('done');
    expect(agentState({ state: 'idle' }, false)).toBe('idle');
  });

  it('keeps a live session at rest apart from a sleeping one or none, so it keeps its dot', () => {
    expect(agentState({ state: 'idle' }, false)).toBe('idle');
    expect(agentState({ state: 'stopped' }, true)).toBe('asleep');
    expect(agentState(undefined, true)).toBe('asleep');
  });
});

describe('failureReason', () => {
  it("prefers the error's message", () => {
    expect(failureReason({ type: 'supervisor', message: 'Process exited' })).toBe('Process exited');
  });

  it('falls back to a label for the type', () => {
    expect(failureReason({ type: 'rate_limit' })).toBe('Rate limited');
    expect(failureReason({ type: 'authentication_failed', message: '  ' })).toBe(
      'Authentication failed',
    );
    expect(failureReason({ type: 'model_not_found' })).toBe('Model not found');
    expect(failureReason({ type: 'server_error' })).toBe('API server error');
    expect(failureReason(undefined)).toBe('Failed');
  });
});

describe('orderTasksByState', () => {
  const activity: Record<string, ActivityInfo> = {
    busy: { state: 'busy' },
    wait: { state: 'waiting', detail: 'Approve Bash' },
    err: { state: 'error', error: { type: 'billing_error' } },
    done: { state: 'idle' },
    seen: { state: 'idle' },
    asleep: { state: 'stopped' },
  };
  const tasks = [
    task('seen', '2026-01-06'),
    task('busy', '2026-01-01'),
    task('done', '2026-01-02'),
    task('err', '2026-01-03'),
    task('none', '2026-01-07'),
    task('wait', '2026-01-04'),
    task('asleep', '2026-01-05'),
  ];

  it('orders needs you, failed, working, done, and keeps idle apart', () => {
    const list = orderTasksByState(tasks, activity, new Set(['done', 'asleep']), []);
    expect(ids(list.active)).toEqual(['wait', 'err', 'busy', 'done']);
    expect(ids(list.idle)).toEqual(['none', 'seen', 'asleep']);
  });

  it('gives needs-you and failed rows a reason, and no one else', () => {
    const list = orderTasksByState(tasks, activity, new Set(['done']), []);
    expect(list.active.map((r) => r.reason)).toEqual([
      'Approve Bash',
      'Billing error',
      undefined,
      undefined,
    ]);
  });

  it('says the task waits for you when no detail came with it', () => {
    const list = orderTasksByState([task('w', 'x')], { w: { state: 'waiting' } }, new Set(), []);
    expect(list.active[0]!.reason).toBe('Waiting for you');
  });

  it('orders a state most recently updated first, ties by id', () => {
    const busy = (id: string, at: string) => task(id, at);
    const list = orderTasksByState(
      [busy('b', '2026-01-01'), busy('c', '2026-01-02'), busy('a', '2026-01-01')],
      { a: { state: 'busy' }, b: { state: 'busy' }, c: { state: 'busy' } },
      new Set(),
      [],
    );
    expect(ids(list.active)).toEqual(['c', 'a', 'b']);
  });

  it('leaves archived tasks out', () => {
    const list = orderTasksByState(
      [task('gone', '2026-01-01', { archivedAt: '2026-01-02' }), task('here', '2026-01-01')],
      {},
      new Set(),
      [],
    );
    expect(ids([...list.active, ...list.idle])).toEqual(['here']);
  });

  it("names each row's project", () => {
    const list = orderTasksByState(
      [
        task('1', '2', { name: 'fix', projectId: 'a' }),
        task('2', '1', { name: 'fix', projectId: 'b' }),
        task('3', '0', { name: 'orphan', projectId: 'gone' }),
      ],
      {},
      new Set(),
      [project('a'), project('b')],
    );
    expect(list.idle.map((r) => r.projectName)).toEqual(['Project a', 'Project b', undefined]);
  });
});

describe('liveRows', () => {
  it('keeps every task with a live session, the one at rest included, in list order', () => {
    const list = orderTasksByState(
      [task('seen', '3'), task('busy', '1'), task('asleep', '4'), task('none', '5')],
      { busy: { state: 'busy' }, seen: { state: 'idle' }, asleep: { state: 'stopped' } },
      new Set(),
      [],
    );
    expect(ids(liveRows(list))).toEqual(['busy', 'seen']);
  });
});

describe('visibleIdleRows', () => {
  const idle = Array.from({ length: IDLE_LIMIT + 3 }, (_, i) => ({
    task: task(`t${i}`, ''),
    state: 'idle' as const,
  }));

  it(`shows the first ${IDLE_LIMIT} until expanded`, () => {
    expect(visibleIdleRows(idle, false, null)).toHaveLength(IDLE_LIMIT);
    expect(visibleIdleRows(idle, true, null)).toHaveLength(idle.length);
  });

  it('keeps a selected task below the cut on show, in place', () => {
    const last = `t${idle.length - 1}`;
    const shown = ids(visibleIdleRows(idle, false, last));
    expect(shown).toHaveLength(IDLE_LIMIT + 1);
    expect(shown.at(-1)).toBe(last);
  });

  it('returns a short list as is', () => {
    expect(visibleIdleRows(idle.slice(0, 2), false, null)).toHaveLength(2);
  });
});

describe('newTaskProjectId', () => {
  const projects = [project('a'), project('b')];
  const tasks = [
    task('1', '2026-01-01', { projectId: 'a' }),
    task('2', '2026-01-03', { projectId: 'b' }),
    task('3', '2026-01-09', { projectId: 'gone' }),
    task('4', '2026-01-08', { projectId: 'a', archivedAt: '2026-01-08' }),
  ];

  it('uses the active project', () => {
    expect(newTaskProjectId('a', projects, tasks)).toBe('a');
  });

  it("else the project of the latest live task that's still listed", () => {
    expect(newTaskProjectId(null, projects, tasks)).toBe('b');
    expect(newTaskProjectId('archived-project', projects, tasks)).toBe('b');
  });

  it('else the first project, or none', () => {
    expect(newTaskProjectId(null, projects, [])).toBe('a');
    expect(newTaskProjectId(null, [], tasks)).toBeNull();
  });
});
