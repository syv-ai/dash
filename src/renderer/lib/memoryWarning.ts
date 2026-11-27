import type { ActivityInfo } from '@shared/types';
import {
  BYTES_PER_GB,
  type MemoryAlert,
  type MemoryPressure,
  type SystemHealthSnapshot,
} from '@shared/systemHealth';

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
  return { title, description, action: sleepIdleLabel(idleCount) };
}

/** "Sleep 2 idle tasks", the toast's and the health popover's action, or null
 *  when nothing is idle. */
export function sleepIdleLabel(idleCount: number): string | null {
  if (idleCount === 0) return null;
  return `Sleep ${idleCount} idle ${idleCount === 1 ? 'task' : 'tasks'}`;
}

export const PRESSURE_LABEL: Record<MemoryPressure, string> = {
  normal: 'Normal',
  warn: 'Warning',
  critical: 'Critical',
};

/** "6.8 GB of 8 GB": Dash's total against the threshold. */
export function usageOfThreshold(s: SystemHealthSnapshot): string {
  return `${formatMemory(s.totalBytes)} of ${formatMemory(s.thresholdBytes)}`;
}

/** The health icon's tooltip line: the usage, and the OS's pressure where it
 *  has one; before the first sample, that it is measuring. */
export function healthSummary(s: SystemHealthSnapshot | null): string {
  if (!s) return 'Measuring…';
  const usage = usageOfThreshold(s);
  return s.pressure ? `${usage} · Memory pressure ${PRESSURE_LABEL[s.pressure]}` : usage;
}
