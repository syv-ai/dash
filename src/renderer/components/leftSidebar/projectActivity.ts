import type { Task, ActivityInfo } from '../../../shared/types';
import type { AgentState } from '../ui/StatusDot';

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

/**
 * The dot a collapsed project shows for its rolled-up activity, or none: a
 * project whose live sessions all sit idle gets no dot, like an idle task.
 */
export function projectActivityDot(
  activity: ProjectActivity,
): { state: AgentState; label: string } | null {
  switch (activity) {
    case 'error':
      return { state: 'fail', label: 'A task failed' };
    case 'waiting':
      return { state: 'needs', label: 'A task needs you' };
    case 'busy':
      return { state: 'work', label: 'Claude is working' };
    default:
      return null;
  }
}
