import type { RateLimitInfo, RateLimits, StatusLineData } from '../../shared/types';

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
