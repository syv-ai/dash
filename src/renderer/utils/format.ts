/**
 * Renderer display formatters. These are presentation-only and used solely by
 * the UI, so they live under renderer/utils — not src/shared, which is reserved
 * for helpers genuinely shared across the main and renderer processes.
 */

/** Compact token count: `999`, `1.5k`, `2.4M`. */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Dollar cost: cents below $100 (`$4.32`), whole dollars at or above (`$123`). */
export function formatCost(n: number): string {
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

/** Elapsed duration from milliseconds: `59s`, `1m 30s`, `2h 1m`. */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Relative reset time from an epoch-seconds timestamp: `now`, `in 30m`, `in 2d 3h`. */
export function formatResetTime(epochSeconds: number, nowMs = Date.now()): string {
  if (!epochSeconds) return '';
  const diffMs = epochSeconds * 1000 - nowMs;
  if (diffMs <= 0) return 'now';
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `in ${diffH}h ${diffMin % 60}m`;
  const diffD = Math.floor(diffH / 24);
  const remH = diffH % 24;
  return remH > 0 ? `in ${diffD}d ${remH}h` : `in ${diffD}d`;
}

/** The locale and zone a clock time is read in; both default to the system's. */
export interface ClockOptions {
  locale?: string;
  timeZone?: string;
}

/**
 * The wall-clock time of an epoch-seconds timestamp, in the user's locale:
 * `14:30` today, `Thu 09:00` on another day (a weekly reset, or a 5-hour one
 * past midnight). '' for 0 (no reset time known).
 */
export function formatResetClock(
  epochSeconds: number,
  nowMs = Date.now(),
  { locale, timeZone }: ClockOptions = {},
): string {
  if (!epochSeconds) return '';
  const at = new Date(epochSeconds * 1000);
  const day = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'short' });
  const time = new Intl.DateTimeFormat(locale, { timeZone, timeStyle: 'short' }).format(at);
  if (day.format(at) === day.format(new Date(nowMs))) return time;
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(at);
  return `${weekday} ${time}`;
}
