import type { Project, Task } from '../../../shared/types';

export interface RotationGroup<T> {
  projectId: string;
  items: T[];
}

/**
 * Group active-task rows by project. Groups follow the project list's order
 * (unknown projects last); rows keep their order within a group.
 */
export function groupByProject<T>(
  items: T[],
  taskOf: (item: T) => Task,
  projects: Project[],
): RotationGroup<T>[] {
  const rank = new Map(projects.map((p, i) => [p.id, i]));
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const pid = taskOf(item).projectId;
    const list = groups.get(pid);
    if (list) list.push(item);
    else groups.set(pid, [item]);
  }
  return [...groups.entries()]
    .map(([projectId, groupItems]) => ({ projectId, items: groupItems }))
    .sort((a, b) => (rank.get(a.projectId) ?? Infinity) - (rank.get(b.projectId) ?? Infinity));
}

/** Rotation tasks in display order: grouped by project, flattened. */
export function orderRotationTasks(tasks: Task[], projects: Project[]): Task[] {
  return groupByProject(tasks, (t) => t, projects).flatMap((g) => g.items);
}
