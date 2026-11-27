/*
 * Auto-sleep (D59): an opt-in setting that puts a task's session to sleep
 * (`claude stop`) once it has rested, seen, for a while. A live session holds
 * about 400 MB; a sleeping one holds nothing and wakes with its context when
 * the task is opened.
 */
import type { ActivityInfo } from '@shared/types';
import { idleTaskIds } from './idleTasks';

export const AUTO_SLEEP_CHOICES = ['off', '1h', '2h', '4h', '8h'] as const;
export type AutoSleepAfter = (typeof AUTO_SLEEP_CHOICES)[number];

export const AUTO_SLEEP_LABELS: Record<AutoSleepAfter, string> = {
  off: 'Never',
  '1h': 'After 1 hour',
  '2h': 'After 2 hours',
  '4h': 'After 4 hours',
  '8h': 'After 8 hours',
};

const HOUR_MS = 60 * 60_000;

const AFTER_MS: Record<Exclude<AutoSleepAfter, 'off'>, number> = {
  '1h': HOUR_MS,
  '2h': 2 * HOUR_MS,
  '4h': 4 * HOUR_MS,
  '8h': 8 * HOUR_MS,
};

/** The choice in ms, or null when off. A dev override in ms
 *  (`VITE_DASH_AUTO_SLEEP_AFTER_MS`) replaces any choice but off. */
export function autoSleepAfterMs(after: AutoSleepAfter, override?: string): number | null {
  if (after === 'off') return null;
  const n = Number(override);
  return override && Number.isFinite(n) && n > 0 ? Math.round(n) : AFTER_MS[after];
}

/** How often to check: once a minute, or a quarter of a shorter duration. */
export function checkEveryMs(afterMs: number): number {
  return Math.min(60_000, Math.max(1_000, Math.round(afterMs / 4)));
}

export interface RestInputs {
  activity: Readonly<Record<string, ActivityInfo>>;
  activeTaskId: string | null;
  /** Finished, not yet opened: the person hasn't seen the result. */
  unseen: ReadonlySet<string>;
  /** Protected tasks, which no automation puts away. */
  protectedIds: ReadonlySet<string>;
  /** Remote control is on: someone may drive the session from elsewhere. */
  remoteControlIds: ReadonlySet<string>;
}

/** Tasks at rest by auto-sleep's measure: idle (the manual action's
 *  predicate), seen, not protected and not under remote control. */
export function restingTaskIds(i: RestInputs): string[] {
  return idleTaskIds(i.activity, i.activeTaskId).filter(
    (id) => !i.unseen.has(id) && !i.protectedIds.has(id) && !i.remoteControlIds.has(id),
  );
}

/**
 * The rest clocks after a change: a task still at rest keeps when its rest
 * began, a task newly at rest starts now, and any other drops out, so a turn,
 * a wait, an unseen finish or a look at the task starts its clock again.
 */
export function trackRest(
  prev: ReadonlyMap<string, number>,
  resting: readonly string[],
  now: number,
): Map<string, number> {
  return new Map(resting.map((id) => [id, prev.get(id) ?? now]));
}

/** Tasks whose rest has lasted `afterMs` or longer. */
export function dueForSleep(
  restSince: ReadonlyMap<string, number>,
  now: number,
  afterMs: number,
): string[] {
  return [...restSince].filter(([, since]) => now - since >= afterMs).map(([id]) => id);
}
