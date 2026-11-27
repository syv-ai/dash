/**
 * System health: how much memory Dash and its task sessions hold, and the
 * warning Settings → Notifications turns on. Main samples and decides when to
 * warn (`SystemHealthService`); the renderer shows the warning and owns the
 * setting.
 */

/** The OS's own verdict on memory (macOS `kern.memorystatus_vm_pressure_level`). */
export type MemoryPressure = 'normal' | 'warn' | 'critical';

export const MEMORY_WARNING_DEFAULT_GB = 8;
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

/** The renderer's setting, pushed to main whenever it changes. */
export interface SystemHealthConfig {
  enabled: boolean;
  thresholdGb: number;
}

export interface TaskMemory {
  taskId: string;
  name: string;
  bytes: number;
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
