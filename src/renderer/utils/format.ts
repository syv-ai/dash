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
 * When an epoch-seconds timestamp falls, in full and in the user's locale:
 * the weekday, then the short date and time (`Thu 26/11/2026, 09:00`).
 * '' for 0 (no reset time known).
 */
export function formatResetAt(
  epochSeconds: number,
  { locale, timeZone }: ClockOptions = {},
): string {
  if (!epochSeconds) return '';
  const at = new Date(epochSeconds * 1000);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(at);
  const when = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(at);
  return `${weekday} ${when}`;
}
