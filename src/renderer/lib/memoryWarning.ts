import {
  BYTES_PER_GB,
  type MemoryAlert,
  type MemoryPressure,
  type SystemHealthSnapshot,
} from '@shared/systemHealth';

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

/** "40 s", "12 min", "1 h 20 min". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "Now" (under 5 s), else "12 min ago": how long before now. */
export function formatAgo(ms: number): string {
  return ms < 5_000 ? 'Now' : `${formatDuration(ms)} ago`;
}

/** "1.2 GB under the warning", "307 MB over the warning", "At the warning"
 *  within half a megabyte: how far Dash's
 *  total sits from the threshold, the health popover's line beside the
 *  figure (the chart's dashed line already names the threshold). */
export function headroomLabel(totalBytes: number, thresholdBytes: number): string {
  const gap = thresholdBytes - totalBytes;
  const size = formatMemory(Math.abs(gap));
  if (size === '0 MB') return 'At the warning';
  return `${size} ${gap > 0 ? 'under' : 'over'} the warning`;
}

/** Dash's share of the memory installed (0–100), or null without a reading.
 *  Of what is installed, not of what is available: available is what Dash
 *  does *not* hold, so a share of it means nothing steady and passes 100 %
 *  under pressure; the popover lists available beside it instead. */
export function machineShare(s: SystemHealthSnapshot): number | null {
  if (!s.machine || s.machine.totalBytes <= 0) return null;
  return Math.min(100, (s.totalBytes / s.machine.totalBytes) * 100);
}
