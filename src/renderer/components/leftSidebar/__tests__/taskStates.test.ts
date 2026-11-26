import { describe, it, expect } from 'vitest';
import type { ActivityInfo, Project, Task } from '../../../../shared/types';
import {
  agentState,
  failureReason,
  liveRows,
  newTaskProjectId,
  orderTasksByState,
  taskGroups,
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

describe('taskGroups', () => {
  const list = orderTasksByState(
    [
      task('busy', '1', { jobId: 'j1' }),
      task('favBusy', '2', { jobId: 'j2', favorite: true }),
      task('seen', '3', { jobId: 'j3' }),
      task('favAsleep', '9', { jobId: 'j4', favorite: true }),
      task('favSeen', '4', { jobId: 'j5', favorite: true }),
      task('asleepOld', '5', { jobId: 'j6' }),
      task('asleepNew', '8', { jobId: 'j7' }),
      task('fresh', '6', { jobId: null }),
      task('waiting', '0', { jobId: 'j8' }),
    ],
    {
      busy: { state: 'busy' },
      favBusy: { state: 'busy' },
      seen: { state: 'idle' },
      favSeen: { state: 'idle' },
      favAsleep: { state: 'stopped' },
      asleepOld: { state: 'stopped' },
      asleepNew: { state: 'stopped' },
      waiting: { state: 'waiting' },
    },
    new Set(),
    [],
  );
  const groups = taskGroups(list);

  it('puts favourites first, whatever their state, live ones ahead of sleeping', () => {
    expect(ids(groups.favorites)).toEqual(['favBusy', 'favSeen', 'favAsleep']);
  });

  it('keeps the live rest in state order, without repeating a favourite', () => {
    expect(ids(groups.news)).toEqual(['waiting', 'busy']);
    expect(ids(groups.resting)).toEqual(['seen', 'fresh']);
  });

  it('lists the sleeping sessions apart, most recent first; a task that never ran stays up', () => {
    expect(ids(groups.inactive)).toEqual(['asleepNew', 'asleepOld']);
  });

  it('places every task exactly once', () => {
    const all = [...groups.favorites, ...groups.news, ...groups.resting, ...groups.inactive];
    expect(ids(all).sort()).toEqual(ids([...list.active, ...list.idle]).sort());
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
