import { describe, it, expect } from 'vitest';
import type { Project, Task } from '../../../../shared/types';
import { groupByProject, orderRotationTasks } from '../rotationGroups';

const project = (id: string) => ({ id, name: id }) as Project;
const task = (id: string, projectId: string) => ({ id, projectId }) as Task;

describe('groupByProject', () => {
  it('groups tasks under their project, in project-list order', () => {
    const tasks = [task('a1', 'a'), task('b1', 'b'), task('a2', 'a')];
    const groups = groupByProject(tasks, (t) => t, [project('b'), project('a')]);
    expect(groups.map((g) => [g.projectId, g.items.map((t) => t.id)])).toEqual([
      ['b', ['b1']],
      ['a', ['a1', 'a2']],
    ]);
  });

  it('puts tasks of an unknown project last', () => {
    const groups = groupByProject([task('x1', 'x'), task('a1', 'a')], (t) => t, [project('a')]);
    expect(groups.map((g) => g.projectId)).toEqual(['a', 'x']);
  });
});

describe('orderRotationTasks', () => {
  it('flattens the groups, keeping the manual order inside each', () => {
    const tasks = [task('a2', 'a'), task('b1', 'b'), task('a1', 'a')];
    expect(orderRotationTasks(tasks, [project('a'), project('b')]).map((t) => t.id)).toEqual([
      'a2',
      'a1',
      'b1',
    ]);
  });
});
