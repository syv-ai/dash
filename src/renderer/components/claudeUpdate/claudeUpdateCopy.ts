import type { ClaudeUpdateState } from '../../../shared/types';

export interface UpdateIndicator {
  kind: 'available' | 'waiting' | 'restarting';
  title: string;
  description: string;
}

export const taskCount = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

/**
 * What the sidebar's update icon says, or null when it hides: it stays while
 * any live session runs an older Claude Code, or while a restart is pending or
 * under way.
 */
export function updateIndicator(state: ClaudeUpdateState | null): UpdateIndicator | null {
  if (!state) return null;
  const { restart, outdated } = state;
  if (restart.phase === 'restarting') {
    return {
      kind: 'restarting',
      title: 'Restarting sessions',
      description: `${restart.done} of ${restart.total} done`,
    };
  }
  if (restart.phase === 'waiting') {
    const n = restart.activeTaskIds.length;
    return {
      kind: 'waiting',
      title: 'Restart when done',
      description: `Waiting for ${n} busy ${n === 1 ? 'task' : 'tasks'}`,
    };
  }
  if (outdated.length === 0) return null;
  return {
    kind: 'available',
    title: `Claude Code ${state.installedVersion} is installed`,
    description: `${taskCount(outdated.length)} ${outdated.length === 1 ? 'runs' : 'run'} an older version`,
  };
}

/** The distinct versions the outdated sessions run, newest first ("2.1.332, 2.1.330"). */
export function oldVersions(outdated: ClaudeUpdateState['outdated']): string {
  const byNumber = (v: string) => v.split('.').map(Number);
  return [...new Set(outdated.map((s) => s.version))]
    .sort((a, b) => {
      const [x, y] = [byNumber(a), byNumber(b)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (y[i] ?? 0) - (x[i] ?? 0);
      return 0;
    })
    .join(', ');
}
