import type { RateLimitInfo, RateLimits, StatusLineData, UsageLimitHit } from './types';

/*
 * The account's rate limits, merged from every session's status line.
 *
 * Each Claude Code session reports the limits it last heard from the API,
 * and drops a window once its reset time has passed, until its next request
 * brings the new one. A session that hasn't made a request yet (every task
 * resumed at launch) reports what it last knew: often the weekly window
 * alone, at an old percentage. Taking the newest report whole, as before,
 * let such a session hide the 5-hour limit and show a stale weekly one.
 *
 * So each limit is merged on its own: the latest window any session reports
 * wins, and within a window the highest reading (use only grows inside a
 * window, so the highest is the most recent).
 */

const LIMIT_KEYS = ['fiveHour', 'sevenDay'] as const satisfies ReadonlyArray<keyof RateLimits>;
/** Sessions report a window's reset time independently; this close is the same window. */
const SAME_WINDOW_S = 60;

/** True while the window `info` describes is still running at `nowMs`. An
 *  unknown reset time (0) counts as running. */
function isCurrent(info: RateLimitInfo, nowMs: number): boolean {
  return !info.resetsAt || info.resetsAt * 1000 > nowMs;
}

/** Whether `a` is a better reading of a limit than `b`: a later window, or
 *  the same window further along. */
function supersedes(a: RateLimitInfo, b: RateLimitInfo): boolean {
  if (Math.abs(a.resetsAt - b.resetsAt) > SAME_WINDOW_S) return a.resetsAt > b.resetsAt;
  return a.usedPercentage > b.usedPercentage;
}

/** Each limit's best current reading across the sessions; undefined when none reports one. */
export function mergeRateLimits(
  data: Record<string, StatusLineData>,
  nowMs: number,
): RateLimits | undefined {
  const merged: RateLimits = {};
  for (const sl of Object.values(data)) {
    for (const key of LIMIT_KEYS) {
      const info = sl.rateLimits?.[key];
      if (!info || !isCurrent(info, nowMs)) continue;
      const best = merged[key];
      if (!best || supersedes(info, best)) merged[key] = info;
    }
  }
  return merged.fiveHour || merged.sevenDay ? merged : undefined;
}

/** At or above this a window counts as the one a limit hit that names none was on. */
export const NEAR_LIMIT_PCT = 90;

/** The window closest to full, when it is at least NEAR_LIMIT_PCT; else null. */
export function nearestLimit(limits: RateLimits | undefined): keyof RateLimits | null {
  let best: keyof RateLimits | null = null;
  for (const key of LIMIT_KEYS) {
    const pct = limits?.[key]?.usedPercentage ?? -1;
    if (pct >= NEAR_LIMIT_PCT && (best === null || pct > limits![best]!.usedPercentage)) best = key;
  }
  return best;
}

/**
 * The limits as shown while the account is at a limit: the hit window full,
 * flagged `reached`, with the hit's reset time, until that passes. The statusLine re-runs on a
 * new assistant message, not on a failed request, so its reading can sit at
 * 97% while the limit is hit. A hit on an unknown window changes nothing.
 */
export function withLimitHit(
  limits: RateLimits | undefined,
  hit: UsageLimitHit | null,
  nowMs: number,
): RateLimits | undefined {
  if (!hit?.limit) return limits;
  const resetsAt = hit.resetsAt || limits?.[hit.limit]?.resetsAt || 0;
  // Past its reset (main's timer runs late after a sleep): over.
  if (resetsAt && resetsAt * 1000 <= nowMs) return limits;
  return { ...limits, [hit.limit]: { usedPercentage: 100, resetsAt, reached: true } };
}

/**
 * A reset time as a clock reads it, in the user's locale: "20:40", with its
 * weekday when it is most of a day away or more ("Sat 20:40").
 */
export function resetClock(
  epochSeconds: number,
  nowMs: number,
  { locale, timeZone }: { locale?: string; timeZone?: string } = {},
): string {
  const at = new Date(epochSeconds * 1000);
  const far = epochSeconds * 1000 - nowMs > 20 * 3_600_000;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(far ? { weekday: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}
