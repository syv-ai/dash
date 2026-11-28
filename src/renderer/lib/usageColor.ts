/*
 * The colour of a usage level, where more is worse. One ramp, green → amber
 * → red, at two sets of stops:
 *
 * - `usageColor`: the done green up to 40 %, easing to the warn amber at
 *   65 % and the fail red at 100 % — the right sidebar's limits and session
 *   figures, its rail, the left sidebar's rail's session rings (X1), and
 *   Settings' meters (T30).
 * - `quietUsageColor`: the same top half, plain ink below 65 % — a task row's
 *   context in the left sidebar, where green would read as the session's
 *   state (S1).
 * - `memoryColor`: memory against the warning threshold, the health
 *   popover's timeline (D62): green to half the threshold, amber by 90 %,
 *   red at the threshold and over.
 *
 * Both mix the role tokens in OKLCH (perceptually even, no muddy midpoint),
 * so they follow the theme like any token does.
 */

/** Where the green starts to move, turns amber, and reaches red (%). */
export interface RampStops {
  calm: number;
  warn: number;
  full: number;
}

export const USAGE_STOPS: RampStops = { calm: 40, warn: 65, full: 100 };
/** Memory as a percent of the warning threshold [provisional, D62]. */
export const MEMORY_STOPS: RampStops = { calm: 50, warn: 90, full: 100 };

const DONE = 'hsl(var(--state-done))';
const INK = 'hsl(var(--ink))';
const WARN = 'hsl(var(--warn))';
const FAIL = 'hsl(var(--state-fail))';

/** `b` mixed into `a` by `t` (0–1), one decimal of a percent. */
function mix(a: string, b: string, t: number): string {
  const share = Math.round(t * 1000) / 10;
  return `color-mix(in oklch, ${b} ${share}%, ${a})`;
}

/** `pct` clamped to 0–100; NaN reads as 0. */
function clamp(pct: number): number {
  return Number.isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
}

/** The top half: amber at `warn`, easing to red at `full`. */
function upper(p: number, { warn, full }: RampStops): string {
  if (p === warn) return WARN;
  if (p < full) return mix(WARN, FAIL, (p - warn) / (full - warn));
  return FAIL;
}

/** Green while there's room, easing to amber, then red. */
function ramp(pct: number, stops: RampStops): string {
  const p = clamp(pct);
  const { calm, warn } = stops;
  if (p <= calm) return DONE;
  if (p < warn) return mix(DONE, WARN, (p - calm) / (warn - calm));
  return upper(p, stops);
}

/** A CSS colour for `pct`: green while there's room, amber, then red. */
export function usageColor(pct: number): string {
  return ramp(pct, USAGE_STOPS);
}

/** A CSS colour for `pct`: plain ink while there's room, then amber and red. */
export function quietUsageColor(pct: number): string {
  const p = clamp(pct);
  return p < USAGE_STOPS.warn ? INK : upper(p, USAGE_STOPS);
}

/** A CSS colour for memory at `pct` of the warning threshold: green well
 *  under, amber as it nears, red once there. */
export function memoryColor(pct: number): string {
  return ramp(pct, MEMORY_STOPS);
}
