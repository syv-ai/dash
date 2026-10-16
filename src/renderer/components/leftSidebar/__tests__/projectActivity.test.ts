import { describe, it, expect } from 'vitest';
import type { ActivityInfo, ActivityState, Task } from '../../../../shared/types';
import { getProjectActivity } from '../projectActivity';

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({ id, projectId: 'p', archivedAt: null, ...over }) as Task;
const states = (m: Record<string, ActivityState>): Record<string, ActivityInfo> =>
  Object.fromEntries(Object.entries(m).map(([id, state]) => [id, { state }]));

describe('getProjectActivity', () => {
  it('shows nothing for a project whose only task is sleeping', () => {
    expect(getProjectActivity([task('a')], states({ a: 'stopped' }))).toBeNull();
  });

  it('shows nothing for tasks that never ran', () => {
    expect(getProjectActivity([task('a')], {})).toBeNull();
  });

  it('ignores a sleeping task beside a live one', () => {
    expect(getProjectActivity([task('a'), task('b')], states({ a: 'stopped', b: 'idle' }))).toBe(
      'idle',
    );
  });

  it('surfaces the most urgent live state', () => {
    const tasks = [task('a'), task('b'), task('c')];
    expect(getProjectActivity(tasks, states({ a: 'idle', b: 'busy', c: 'waiting' }))).toBe(
      'waiting',
    );
    expect(getProjectActivity(tasks, states({ a: 'error', b: 'busy', c: 'waiting' }))).toBe(
      'error',
    );
  });

  it('ignores archived tasks', () => {
    expect(
      getProjectActivity([task('a', { archivedAt: '2026-01-01' })], states({ a: 'busy' })),
    ).toBeNull();
  });
});
