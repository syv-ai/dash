import type { Task, ActivityInfo } from '../../../shared/types';

export type ProjectActivity = 'busy' | 'idle' | 'waiting' | 'error' | null;

/**
 * Roll up a project's task activity into a single status, using the same
 * severity order the sidebar dots use (error > waiting > busy > idle).
 * Archived tasks are ignored.
 */
export function getProjectActivity(
  tasks: Task[],
  taskActivity: Record<string, ActivityInfo>,
): ProjectActivity {
  const active = tasks.filter((t) => !t.archivedAt);
  if (active.some((t) => taskActivity[t.id]?.state === 'error')) return 'error';
  if (active.some((t) => taskActivity[t.id]?.state === 'waiting')) return 'waiting';
  if (active.some((t) => taskActivity[t.id]?.state === 'busy')) return 'busy';
  if (active.some((t) => taskActivity[t.id]?.state === 'idle')) return 'idle';
  return null;
}
