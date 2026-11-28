import type { RateLimits, UsageLimitHit } from '@shared/types';
import { nearestLimit, resetClock } from '@shared/rateLimits';

/*
 * The account's usage limit, one state for every task: a limit is
 * account-wide, so five busy tasks hitting it are one hit, not five.
 * Pure: UsageLimitService holds the state and acts on the transitions.
 */

export type LimitKey = keyof RateLimits;

/**
 * The window a limit hit names in its text. Claude Code renders a plan limit
 * as "You've hit your 5-hour limit · resets 8:40pm (Europe/Copenhagen)" (live,
 * 2.1.332 transcripts; the docs give only a 429's "API Error: Rate limit
 * reached"). Undefined when the text names no window.
 */
function windowInText(text: string | undefined): LimitKey | undefined {
  if (!text) return undefined;
  if (/\b(5|five)[- ]hour\b/i.test(text)) return 'fiveHour';
  if (/\b(weekly|7[- ]day|seven[- ]day)\b/i.test(text)) return 'sevenDay';
  return undefined;
}

/**
 * Which limit a StopFailure `rate_limit` hit: the window its text names,
 * else the window the statusLines last read closest to full (from
 * NEAR_LIMIT_PCT), else unknown. Its reset time is that window's, while it
 * is still ahead.
 */
export function inferLimitHit(
  text: string | undefined,
  limits: RateLimits | undefined,
  nowMs: number,
): Omit<UsageLimitHit, 'hitAt'> {
  const limit = windowInText(text) ?? nearestLimit(limits);
  const resetsAt = limit ? (limits?.[limit]?.resetsAt ?? 0) : 0;
  return { limit, resetsAt: resetsAt * 1000 > nowMs ? resetsAt : 0 };
}

export interface UsageLimitState {
  hit: UsageLimitHit | null;
  /** The tasks the hit turned red, to put back when it clears. */
  tasks: ReadonlySet<string>;
}

export const NO_LIMIT: UsageLimitState = { hit: null, tasks: new Set() };

/**
 * A task's turn ended on the limit. `notify` once per hit: the first task
 * to hit it, or a different window than the one held (the 5-hour limit
 * resets into the weekly one) [provisional]. A repeat keeps its first
 * `hitAt` and learns a reset time it lacked.
 */
export function hitLimit(
  state: UsageLimitState,
  ptyId: string,
  next: Omit<UsageLimitHit, 'hitAt'>,
  nowMs: number,
): { state: UsageLimitState; notify: boolean } {
  const tasks = new Set(state.tasks).add(ptyId);
  const held = state.hit;
  if (held && held.limit === next.limit) {
    const resetsAt = held.resetsAt || next.resetsAt;
    return { state: { hit: { ...held, resetsAt }, tasks }, notify: false };
  }
  return { state: { hit: { ...next, hitAt: nowMs }, tasks }, notify: true };
}

/** The limit is over: the tasks it turned red go back. */
export function clearLimit(state: UsageLimitState): { state: UsageLimitState; revert: string[] } {
  return { state: NO_LIMIT, revert: [...state.tasks] };
}

/** Whether the held hit's reset time has passed at `nowMs`. */
export function limitExpired(state: UsageLimitState, nowMs: number): boolean {
  const resetsAt = state.hit?.resetsAt ?? 0;
  return resetsAt > 0 && resetsAt * 1000 <= nowMs;
}

/** The notification's words for `hit`: "5-hour limit reached", "Resets at 20:40". */
export function limitNotice(
  hit: UsageLimitHit,
  nowMs: number,
  clock: { locale?: string; timeZone?: string } = {},
): { title: string; body: string } {
  const name =
    hit.limit === 'fiveHour'
      ? '5-hour limit'
      : hit.limit === 'sevenDay'
        ? 'Weekly limit'
        : 'Usage limit';
  if (!hit.resetsAt) return { title: `${name} reached`, body: 'Tasks pause until it resets.' };
  return { title: `${name} reached`, body: `Resets at ${resetClock(hit.resetsAt, nowMs, clock)}` };
}
