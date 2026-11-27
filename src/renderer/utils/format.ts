/**
 * Renderer display formatters. These are presentation-only and used solely by
 * the UI, so they live under renderer/utils — not src/shared, which is reserved
 * for helpers genuinely shared across the main and renderer processes.
 */

const TOKEN_UNITS = ['', 'k', 'M', 'B', 'T'] as const;

/**
 * `n` in the largest token unit that keeps it below 1000, rounded to
 * `places(value)` decimals (always 0 for a plain count). The unit is picked
 * after rounding, so a count that rounds up to 1000 of one unit reads as 1 of
 * the next (999_999 → 1M, never 1000k). Past trillions it stays in `T`.
 */
function inTokenUnits(
  n: number,
  places: (value: number) => number,
): { value: number; places: number; unit: string } {
  let value = n;
  for (let unit = 0; ; unit++) {
    const p = unit === 0 ? 0 : places(value);
    const rounded = Math.round(value * 10 ** p) / 10 ** p;
    if (rounded < 1000 || unit === TOKEN_UNITS.length - 1) {
      return { value: rounded, places: p, unit: TOKEN_UNITS[unit] ?? '' };
    }
    value /= 1000;
  }
}

/**
 * Compact token count, at most three significant figures: one decimal below
 * 10 of a unit (`1.5k`, `2.4M`, `1.2B`), whole numbers above (`12k`, `120B`),
 * a trailing `.0` dropped (`1k`).
 */
export function formatTokens(n: number): string {
  const { value, unit } = inTokenUnits(n, (v) => (v < 10 ? 1 : 0));
  return `${value}${unit}`;
}

/**
 * Token count to two decimals in its unit (`2.21B`, `1.05M`, `12.34k`),
 * trailing zeros kept so the width holds steady as it climbs (`1.00M`); a
 * plain count below 1000. For the task header, where the count is watched.
 */
export function formatTokensPrecise(n: number): string {
  const { value, places, unit } = inTokenUnits(n, () => 2);
  return `${value.toFixed(places)}${unit}`;
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

/** A span ahead, to the minute: `30m`, `2h 10m`, `2d 3h`. */
export function formatSpan(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 > 0 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** What "TTR" stands for, for a tooltip that shows one. */
export const TTR_MEANING = 'TTR = Time To Reset.';

/** The time to a reset `ms` ahead, "TTR 2d 20h"; "TTR now" once it is due. */
export function formatTtr(ms: number): string {
  return ms <= 0 ? 'TTR now' : `TTR ${formatSpan(ms)}`;
}

/** Relative reset time from an epoch-seconds timestamp: `now`, `in 30m`, `in 2d 3h`. */
export function formatResetTime(epochSeconds: number, nowMs = Date.now()): string {
  if (!epochSeconds) return '';
  const diffMs = epochSeconds * 1000 - nowMs;
  return diffMs <= 0 ? 'now' : `in ${formatSpan(diffMs)}`;
}

/** The locale and zone a clock time is read in; both default to the system's. */
export interface ClockOptions {
  locale?: string;
  timeZone?: string;
}

/**
 * When an epoch-seconds timestamp falls, in full (`formatDateTime`). '' for
 * 0 (no reset time known).
 */
export function formatResetAt(epochSeconds: number, clock?: ClockOptions): string {
  return epochSeconds ? formatDateTime(new Date(epochSeconds * 1000), clock) : '';
}

/**
 * A moment in full, in the user's locale: the weekday, then the short date
 * and time (`Thu 26/11/2026, 09:00`).
 */
export function formatDateTime(at: Date, { locale, timeZone }: ClockOptions = {}): string {
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(at);
  const when = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(at);
  return `${weekday} ${when}`;
}
