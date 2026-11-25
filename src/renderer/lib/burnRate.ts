import type { RateLimitInfo, RateLimits } from '../../shared/types';
import { formatSpan } from '../utils/format';

/*
 * Burn rate: how fast a usage limit is being used (%/hour, the first
 * derivative of its used % over a trailing window) and when, at that pace, it
 * reaches 100 %. Readings are kept in memory per limit window; a new window
 * (another reset time) or a falling % starts the history over.
 */

/** One reading of a limit's used %, at epoch ms. */
export interface UsageSample {
  at: number;
  pct: number;
}

/** Recent readings of one limit window, which its reset time identifies. */
export interface LimitHistory {
  /** Epoch seconds, as in RateLimitInfo. */
  resetsAt: number;
  /** Oldest first, spaced at least SAMPLE_GAP_MS apart except the newest. */
  samples: UsageSample[];
}

export type LimitKey = keyof RateLimits;
export type LimitHistories = Partial<Record<LimitKey, LimitHistory>>;

export interface Burn {
  /** Percentage points per hour, above MIN_RATE. */
  perHour: number;
  /** Time until 100 % at this pace; null when the window resets first. */
  toLimitMs: number | null;
  /** Time until the window resets; null when it reports no reset time. */
  resetsInMs: number | null;
  /** The used % the window would reach at its reset at this pace (over 100:
   *  the limit comes first); Infinity without a reset time. */
  atResetPct: number;
}

/**
 * How a burn looks against its window, by the used % it projects for the
 * reset (`atResetPct`): `over` past 100 (the limit comes before the reset),
 * `close` from CLOSE_AT_PCT up to 100, `clear` below.
 */
export type BurnOutlook = 'clear' | 'close' | 'over';

/** From this projected % at the reset, a burn is close to its limit. */
export const CLOSE_AT_PCT = 85;

export function burnOutlook(burn: Pick<Burn, 'atResetPct'>): BurnOutlook {
  if (burn.atResetPct > 100) return 'over';
  return burn.atResetPct >= CLOSE_AT_PCT ? 'close' : 'clear';
}

/** Each reported limit's burn; null while there is too little data or it isn't rising. */
export type LimitBurns = Partial<Record<LimitKey, Burn | null>>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How far back the rate looks. The weekly % moves slowly, so it looks further. */
export const BURN_WINDOW_MS: Record<LimitKey, number> = {
  fiveHour: 30 * MINUTE,
  sevenDay: 2 * HOUR,
};
/** The window's first and last readings must be at least this far apart. */
export const MIN_SPAN_MS = 5 * MINUTE;
/** A reading this close to the one before it replaces it (bounds the history). */
export const SAMPLE_GAP_MS = 15_000;
/** Sessions report the reset time independently; this close is the same window. */
const SAME_WINDOW_S = 60;
/** Slower than this (%/h) is not burning. */
const MIN_RATE = 0.05;

/** The history with `info` read at `now` added, and readings older than the window dropped. */
export function recordSample(
  history: LimitHistory | undefined,
  info: RateLimitInfo,
  now: number,
  windowMs: number,
): LimitHistory {
  const sample = { at: now, pct: info.usedPercentage };
  const last = history?.samples.at(-1);
  const newWindow = !history || Math.abs(history.resetsAt - info.resetsAt) > SAME_WINDOW_S;
  if (newWindow || !last || sample.pct < last.pct) {
    return { resetsAt: info.resetsAt, samples: [sample] };
  }
  const kept = history.samples.filter((s) => now - s.at <= windowMs);
  // The newest reading is provisional until the gap after the one before it fills.
  const [prev, newest] = kept.slice(-2);
  if (prev && newest && newest.at - prev.at < SAMPLE_GAP_MS) kept.pop();
  kept.push(sample);
  return { resetsAt: history.resetsAt, samples: kept };
}

/** Every limit in `limits` recorded into `histories`; limits not reported keep theirs. */
export function recordLimits(
  histories: LimitHistories,
  limits: RateLimits,
  now: number,
): LimitHistories {
  const next = { ...histories };
  for (const key of Object.keys(BURN_WINDOW_MS) as LimitKey[]) {
    const info = limits[key];
    if (info) next[key] = recordSample(histories[key], info, now, BURN_WINDOW_MS[key]);
  }
  return next;
}

/** %/hour over the trailing window, or null without two readings MIN_SPAN_MS apart. */
export function ratePerHour(
  history: LimitHistory | undefined,
  now: number,
  windowMs: number,
): number | null {
  const recent = history?.samples.filter((s) => now - s.at <= windowMs) ?? [];
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || first === last) return null;
  const span = last.at - first.at;
  if (span < MIN_SPAN_MS) return null;
  return (last.pct - first.pct) / (span / HOUR);
}

/**
 * The limit's burn: its rate and the time to 100 % (null if the window resets
 * first). Null when there isn't enough data or the % isn't rising.
 */
export function burnFor(
  history: LimitHistory | undefined,
  info: RateLimitInfo,
  now: number,
  windowMs: number,
): Burn | null {
  const perHour = ratePerHour(history, now, windowMs);
  if (perHour === null || perHour < MIN_RATE) return null;
  const toLimitMs = (Math.max(0, 100 - info.usedPercentage) / perHour) * HOUR;
  const resetsInMs = info.resetsAt ? Math.max(0, info.resetsAt * 1000 - now) : null;
  if (resetsInMs === null) return { perHour, toLimitMs, resetsInMs, atResetPct: Infinity };
  return {
    perHour,
    toLimitMs: toLimitMs >= resetsInMs ? null : toLimitMs,
    resetsInMs,
    atResetPct: info.usedPercentage + perHour * (resetsInMs / HOUR),
  };
}

/**
 * Each reported limit's burn as of its latest reading (null: not enough data
 * or not rising). Limits not reported are left out.
 */
export function limitBurns(histories: LimitHistories, limits: RateLimits): LimitBurns {
  const out: LimitBurns = {};
  for (const key of Object.keys(BURN_WINDOW_MS) as LimitKey[]) {
    const info = limits[key];
    const latest = histories[key]?.samples.at(-1);
    if (!info) continue;
    out[key] = latest ? burnFor(histories[key], info, latest.at, BURN_WINDOW_MS[key]) : null;
  }
  return out;
}

/**
 * The burn worth showing when there is room for one: the limit reached
 * soonest at its pace, else (both reset first) the one that comes closest to
 * its limit by its reset. Null when neither limit is burning.
 */
export function pressingBurn(burns: LimitBurns): { limit: LimitKey; burn: Burn } | null {
  let best: { limit: LimitKey; burn: Burn } | null = null;
  for (const limit of Object.keys(BURN_WINDOW_MS) as LimitKey[]) {
    const burn = burns[limit];
    if (!burn) continue;
    if (!best || morePressing(burn, best.burn)) best = { limit, burn };
  }
  return best;
}

function morePressing(a: Burn, b: Burn): boolean {
  if (a.toLimitMs !== null && b.toLimitMs !== null) return a.toLimitMs < b.toLimitMs;
  if (a.toLimitMs !== null || b.toLimitMs !== null) return a.toLimitMs !== null;
  return a.atResetPct > b.atResetPct;
}

/** "+6%/h"; under 10, one decimal ("+0.4%/h", "+2.5%/h"). */
export function formatRate(perHour: number): string {
  const n = perHour < 10 ? Math.round(perHour * 10) / 10 : Math.round(perHour);
  return `+${n}%/h`;
}

/** Where the pace takes a limit: "At this rate you'd reach 100% in 2h 10m;
 *  resets in 3h 44m", or the % it would reach by its reset. */
export function formatProjection(burn: Burn): string {
  const resets = burn.resetsInMs === null ? '' : `; resets in ${formatSpan(burn.resetsInMs)}`;
  if (burn.toLimitMs !== null) {
    return `At this rate you'd reach 100% in ${formatSpan(burn.toLimitMs)}${resets}`;
  }
  return `At this rate you'd reach ${Math.round(burn.atResetPct)}% by then${resets}`;
}
