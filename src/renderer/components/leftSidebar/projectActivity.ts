import type { Task, ActivityInfo } from '../../../shared/types';

export type ProjectActivity = 'busy' | 'idle' | 'waiting' | 'error' | null;

/**
 * Roll up a project's task activity into a single status, using the same
 * severity order the sidebar dots use (error > waiting > busy > idle).
 * Archived tasks are ignored, and so are sleeping (`stopped`) ones: opening
 * a sleeping task resumes it just like one that never ran, so neither gets a
 * dot — only a live session does.
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

/** Dot class and tooltip for a project's rolled-up activity. */
export function projectActivityDot(activity: Exclude<ProjectActivity, null>): {
  className: string;
  label: string;
} {
  switch (activity) {
    case 'error':
      return { className: 'status-dot-err', label: 'Error' };
    case 'waiting':
      return { className: 'status-dot-wait', label: 'Waiting for user' };
    case 'busy':
      return { className: 'bg-amber-400 status-pulse', label: 'Claude is working' };
    case 'idle':
      return { className: 'status-dot-idle', label: 'Idle' };
  }
}
