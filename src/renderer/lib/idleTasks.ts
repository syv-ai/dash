import type { ActivityInfo } from '@shared/types';

/**
 * Tasks that may be put to sleep: a live session at rest (the orb done or
 * unseen), not working, not waiting on the user, not failed, not compacting,
 * and not the task on screen. "Sleep idle tasks" takes them all; auto-sleep
 * narrows them further (autoSleep.ts).
 */
export function idleTaskIds(
  activity: Readonly<Record<string, ActivityInfo>>,
  activeTaskId: string | null,
): string[] {
  return Object.entries(activity)
    .filter(([id, a]) => a.state === 'idle' && !a.compacting && id !== activeTaskId)
    .map(([id]) => id);
}
