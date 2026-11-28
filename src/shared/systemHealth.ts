/**
 * System health: how much memory Dash and its task sessions hold, the warning
 * and the sidebar's health icon (Settings → System health). Main samples and
 * decides when to warn (`SystemHealthService`); the renderer shows the warning
 * and the icon and owns the settings.
 */

/** The OS's own verdict on memory (macOS `kern.memorystatus_vm_pressure_level`). */
export type MemoryPressure = 'normal' | 'warn' | 'critical';

/**
 * The default threshold for the memory measure each platform uses. macOS
 * measures physical footprint (Activity Monitor's Memory), which runs ~0.65
 * of the RSS the 8 GB default was tuned on, so 6 keeps the warning near where
 * it fired [provisional, 2026-11-28]. Linux (RSS) and Windows (working set)
 * still measure what 8 was tuned on.
 */
export function memoryWarningDefaultGb(isMac: boolean): number {
  return isMac ? 6 : 8;
}

/** Main has `process.platform`; the sandboxed renderer reads `navigator`. */
const HOST_IS_MAC =
  typeof process !== 'undefined' && typeof process.platform === 'string'
    ? process.platform === 'darwin'
    : typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

export const MEMORY_WARNING_DEFAULT_GB = memoryWarningDefaultGb(HOST_IS_MAC);
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

/**
 * The machine's physical memory and how much of it is still available to
 * apps, as the OS counts it: macOS free + file cache + purgeable pages (what
 * Activity Monitor's physical memory leaves after Memory Used), Linux
 * `MemAvailable`, Windows available physical memory (free + standby).
 */
export interface MachineMemory {
  totalBytes: number;
  availableBytes: number;
}

/** One point of the popover's timeline: Dash's total at a sample. */
export interface HealthPoint {
  at: number;
  totalBytes: number;
}

/** How far back main keeps the timeline (and the popover draws it). */
export const HEALTH_HISTORY_MS = 2 * 60 * 60_000;

/** One sample for the health icon and its popover, sent on every sample while
 *  the icon is on (`systemHealth:snapshot`). */
export interface SystemHealthSnapshot extends HealthReading {
  level: HealthLevel;
  /** Every live task session, heaviest first. */
  tasks: TaskMemory[];
  /** null where it couldn't be read. */
  machine: MachineMemory | null;
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
