import type { RateLimitInfo, RateLimits } from '../../shared/types';
import { formatSpan, formatTtr } from '../utils/format';

/*
 * Burn rate, in two parts (D247). The barometer: how fast a usage limit is
 * being used right now (%/hour over a short trailing look-back). The
 * projection: the window's own average pace so far (used % over the time
 * since it started, idle time included) and where that pace leads by the
 * reset, which sets the colour. Readings are kept in memory per limit window;
 * a new window (another reset time) or a falling % starts the history over.
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

/** Where a limit's window is heading at its own average pace so far. */
export interface Projection {
  /** The window's average: used % over the hours since it started. */
  perHour: number;
  /** Time until 100 % at this pace; null when the window resets first. */
  toLimitMs: number | null;
  /** Time until the window resets. */
  resetsInMs: number;
  /** The used % the window would reach at its reset at this pace (over 100:
   *  the limit comes first). */
  atResetPct: number;
}

/** One limit's burn: the barometer and the projection, each null while it
 *  has too little to go on. */
export interface Burn {
  /** %/hour over the look-back (`BURN_WINDOW_MS`); null with too few readings
   *  or while the % isn't rising. */
  perHour: number | null;
  /** Null without a reset time, or under MIN_ELAPSED_MS into the window. */
  projection: Projection | null;
}

/**
 * How a burn looks against its window, by the used % it projects for the
 * reset (`atResetPct`): `over` past 100 (the limit comes before the reset),
 * `close` from CLOSE_AT_PCT up to 100, `clear` below.
 */
export type BurnOutlook = 'clear' | 'close' | 'over';

/** From this projected % at the reset, a burn is close to its limit. */
export const CLOSE_AT_PCT = 85;

export function burnOutlook(projection: Pick<Projection, 'atResetPct'>): BurnOutlook {
  if (projection.atResetPct > 100) return 'over';
  return projection.atResetPct >= CLOSE_AT_PCT ? 'close' : 'clear';
}

/** Each reported limit's burn. */
export type LimitBurns = Partial<Record<LimitKey, Burn>>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How far back the barometer looks. The weekly % moves slowly, so it looks further. */
export const BURN_WINDOW_MS: Record<LimitKey, number> = {
  fiveHour: 30 * MINUTE,
  sevenDay: HOUR,
};
/** Each limit's whole window: it started this long before its reset. */
export const LIMIT_WINDOW_MS: Record<LimitKey, number> = {
  fiveHour: 5 * HOUR,
  sevenDay: 7 * 24 * HOUR,
};
/** Less of the window gone than this is too little to average over. */
export const MIN_ELAPSED_MS = 15 * MINUTE;
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
 * Where the window's average pace so far takes the limit: used % over the
 * time since the window started (`windowMs` before its reset), carried on to
 * the reset. Null without a reset time or under MIN_ELAPSED_MS in.
 */
export function projectAverage(
  info: RateLimitInfo,
  now: number,
  windowMs: number,
): Projection | null {
  if (!info.resetsAt) return null;
  const resetsInMs = Math.max(0, info.resetsAt * 1000 - now);
  const elapsedMs = windowMs - resetsInMs;
  if (elapsedMs < MIN_ELAPSED_MS) return null;
  const used = info.usedPercentage;
  const perHour = used / (elapsedMs / HOUR);
  const toLimitMs = perHour > 0 ? (Math.max(0, 100 - used) / perHour) * HOUR : Infinity;
  return {
    perHour,
    toLimitMs: toLimitMs >= resetsInMs ? null : toLimitMs,
    resetsInMs,
    atResetPct: used + perHour * (resetsInMs / HOUR),
  };
}

/**
 * Each reported limit's burn as of its latest reading. Limits not reported
 * are left out.
 */
export function limitBurns(histories: LimitHistories, limits: RateLimits): LimitBurns {
  const out: LimitBurns = {};
  for (const key of Object.keys(BURN_WINDOW_MS) as LimitKey[]) {
    const info = limits[key];
    if (!info) continue;
    const now = histories[key]?.samples.at(-1)?.at;
    if (now === undefined) {
      out[key] = { perHour: null, projection: null };
      continue;
    }
    const rate = ratePerHour(histories[key], now, BURN_WINDOW_MS[key]);
    out[key] = {
      perHour: rate !== null && rate >= MIN_RATE ? rate : null,
      projection: projectAverage(info, now, LIMIT_WINDOW_MS[key]),
    };
  }
  return out;
}

/** The burn the row shows: a limit with a barometer reading. */
export interface PressingBurn {
  limit: LimitKey;
  perHour: number;
  projection: Projection | null;
}

/**
 * The burn worth showing when there is room for one, among the limits with a
 * barometer reading, by their projections: the limit reached soonest, else
 * (all reset first) the one that comes closest to its limit by its reset; a
 * limit with no projection yet last. Null when no limit is burning.
 */
export function pressingBurn(burns: LimitBurns): PressingBurn | null {
  let best: PressingBurn | null = null;
  for (const limit of Object.keys(BURN_WINDOW_MS) as LimitKey[]) {
    const burn = burns[limit];
    if (!burn || burn.perHour === null) continue;
    if (!best || morePressing(burn.projection, best.projection)) {
      best = { limit, perHour: burn.perHour, projection: burn.projection };
    }
  }
  return best;
}

function morePressing(a: Projection | null, b: Projection | null): boolean {
  if (!a || !b) return !b && !!a;
  if (a.toLimitMs !== null && b.toLimitMs !== null) return a.toLimitMs < b.toLimitMs;
  if (a.toLimitMs !== null || b.toLimitMs !== null) return a.toLimitMs !== null;
  return a.atResetPct > b.atResetPct;
}

/** "+6%/h"; under 10, one decimal ("+0.4%/h", "+2.5%/h"). */
export function formatRate(perHour: number): string {
  const n = perHour < 10 ? Math.round(perHour * 10) / 10 : Math.round(perHour);
  return `+${n}%/h`;
}

/** An average pace, unsigned: "0.56%/h" under 1, "2.5%/h" under 10, else whole. */
export function formatPace(perHour: number): string {
  const places = perHour < 1 ? 2 : perHour < 10 ? 1 : 0;
  return `${Number(perHour.toFixed(places))}%/h`;
}

/** The average pace and where it leads: "0.56%/h → ~94% at reset; TTR 2d 20h",
 *  or "12%/h → 100% in 2h 10m; TTR 3h 44m" when the limit comes first. */
export function formatProjection(p: Projection): string {
  const where =
    p.toLimitMs !== null
      ? `100% in ${formatSpan(p.toLimitMs)}`
      : `~${Math.round(p.atResetPct)}% at reset`;
  return `${formatPace(p.perHour)} → ${where}; ${formatTtr(p.resetsInMs)}`;
}
