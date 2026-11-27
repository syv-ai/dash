import type { ActivityInfo } from '@shared/types';
import { BYTES_PER_GB, type MemoryAlert } from '@shared/systemHealth';

/**
 * Tasks the memory warning may put to sleep: a live session at rest (the orb
 * done or unseen), not working, not waiting on the user, not failed, and not
 * the task on screen.
 */
export function idleTaskIds(
  activity: Readonly<Record<string, ActivityInfo>>,
  activeTaskId: string | null,
): string[] {
  return Object.entries(activity)
    .filter(([id, a]) => a.state === 'idle' && !a.compacting && id !== activeTaskId)
    .map(([id]) => id);
}

/** "9.2 GB", or "850 MB" under a gigabyte. */
export function formatMemory(bytes: number): string {
  const gb = bytes / BYTES_PER_GB;
  if (gb >= 1) return `${Number(gb.toFixed(1))} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export interface MemoryWarningCopy {
  title: string;
  description: string;
  /** The action's label, or null when nothing is idle. */
  action: string | null;
}

export function memoryWarningCopy(alert: MemoryAlert, idleCount: number): MemoryWarningCopy {
  const total = formatMemory(alert.totalBytes);
  const title = alert.reason === 'pressure' ? 'Memory is running low' : `Dash is using ${total}`;
  const lead =
    alert.reason === 'pressure'
      ? `Dash and its sessions use ${total}.`
      : `Over your ${formatMemory(alert.thresholdBytes)} warning.`;
  const heaviest = alert.topTasks
    .filter((t) => t.name)
    .map((t) => `${t.name} ${formatMemory(t.bytes)}`)
    .join(', ');
  const description = heaviest ? `${lead} Heaviest: ${heaviest}.` : lead;
  const action =
    idleCount === 0 ? null : `Sleep ${idleCount} idle ${idleCount === 1 ? 'task' : 'tasks'}`;
  return { title, description, action };
}
