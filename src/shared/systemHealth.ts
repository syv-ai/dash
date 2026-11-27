/**
 * System health: how much memory Dash and its task sessions hold, the warning
 * and the sidebar's health icon (Settings → System health). Main samples and
 * decides when to warn (`SystemHealthService`); the renderer shows the warning
 * and the icon and owns the settings.
 */

/** The OS's own verdict on memory (macOS `kern.memorystatus_vm_pressure_level`). */
export type MemoryPressure = 'normal' | 'warn' | 'critical';

/** Memory is the physical footprint on macOS (Activity Monitor's Memory),
 *  which runs ~0.65 of the RSS this was first tuned on (8 GB): 6 keeps the
 *  warning near where it fired. [provisional, 2026-11-28] */
export const MEMORY_WARNING_DEFAULT_GB = 6;
export const MEMORY_WARNING_MIN_GB = 0.5;
export const MEMORY_WARNING_MAX_GB = 256;

/** A threshold in GB the setting accepts: a garbage value gets the default, the
 *  rest is held to MIN..MAX in half-GB steps. */
export function clampMemoryWarningGb(gb: number): number {
  if (!Number.isFinite(gb)) return MEMORY_WARNING_DEFAULT_GB;
  const half = Math.round(gb * 2) / 2;
  return Math.min(MEMORY_WARNING_MAX_GB, Math.max(MEMORY_WARNING_MIN_GB, half));
}

export const BYTES_PER_GB = 1024 ** 3;

/** The renderer's settings, pushed to main whenever they change. Main samples
 *  while either is on. */
export interface SystemHealthConfig {
  /** The memory warning (toast, or a desktop notification in the background). */
  alerts: boolean;
  /** The sidebar's health icon: a snapshot after every sample. */
  indicator: boolean;
  thresholdGb: number;
}

/** How the icon reads: `warn` past the threshold or under macOS's "warn"
 *  pressure, `critical` under its "critical" pressure. */
export type HealthLevel = 'ok' | 'warn' | 'critical';

export interface HealthReading {
  totalBytes: number;
  thresholdBytes: number;
  /** null where the platform has no pressure signal. */
  pressure: MemoryPressure | null;
}

/** The one verdict the icon and the warning share, so they never disagree. */
export function healthLevel(r: HealthReading): HealthLevel {
  if (r.pressure === 'critical') return 'critical';
  if (r.pressure === 'warn' || r.totalBytes >= r.thresholdBytes) return 'warn';
  return 'ok';
}

export interface TaskMemory {
  taskId: string;
  name: string;
  bytes: number;
}

/** One sample for the health icon and its popover, sent on every sample while
 *  the icon is on (`systemHealth:snapshot`). */
export interface SystemHealthSnapshot extends HealthReading {
  level: HealthLevel;
  /** Every live task session, heaviest first. */
  tasks: TaskMemory[];
  /** When it was taken (ms). */
  sampledAt: number;
}

/** One warning: main crossed the threshold, or the OS said memory is tight. */
export interface MemoryAlert {
  reason: 'threshold' | 'pressure';
  /** Dash's processes plus every task session's process tree. */
  totalBytes: number;
  thresholdBytes: number;
  pressure: MemoryPressure | null;
  /** The heaviest task sessions, largest first (at most three). */
  topTasks: TaskMemory[];
}
