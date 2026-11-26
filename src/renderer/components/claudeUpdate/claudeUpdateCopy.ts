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
    description: outdatedLine(outdated.length),
  };
}

/** How many live sessions lag behind ("2 tasks run an older version"). */
export function outdatedLine(n: number): string {
  return `${taskCount(n)} ${n === 1 ? 'runs' : 'run'} an older version`;
}

/**
 * Who "Interrupt and restart all" would cut off: the outdated tasks that are
 * busy (working, or waiting on the user), named while there are one or two,
 * counted beyond that; null when none is.
 */
export function interruptNote(busyNames: readonly string[]): string | null {
  const n = busyNames.length;
  if (n === 0) return null;
  if (n === 1) return `${busyNames[0]} is busy and will be interrupted.`;
  if (n === 2) return `${busyNames[0]} and ${busyNames[1]} are busy and will be interrupted.`;
  return `${n} tasks are busy and will be interrupted.`;
}
