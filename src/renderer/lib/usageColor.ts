/*
 * The colour of a usage level, where more is worse. Two ramps share their top
 * half: the warn amber at 65 %, easing to the fail red at 100 %.
 *
 * - `usageColor`: the done green up to 40 %, easing to the amber at 65 % —
 *   the right sidebar's limits and session figures, its rail, the left
 *   sidebar's rail's session rings (X1), and Settings' meters (T30).
 * - `quietUsageColor`: plain ink below 65 % — a task row's context in the
 *   left sidebar, where green would read as the session's state (S1).
 *
 * Both mix the role tokens in OKLCH (perceptually even, no muddy midpoint),
 * so they follow the theme like any token does.
 */

/** Where the green starts to move, turns amber, and reaches red (%). */
export const USAGE_STOPS = { calm: 40, warn: 65, full: 100 } as const;

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

/** The shared top half: amber at 65 %, easing to red at 100 %. */
function upper(p: number): string {
  const { warn, full } = USAGE_STOPS;
  if (p === warn) return WARN;
  if (p < full) return mix(WARN, FAIL, (p - warn) / (full - warn));
  return FAIL;
}

/** A CSS colour for `pct`: green while there's room, amber, then red. */
export function usageColor(pct: number): string {
  const p = clamp(pct);
  const { calm, warn } = USAGE_STOPS;
  if (p <= calm) return DONE;
  if (p < warn) return mix(DONE, WARN, (p - calm) / (warn - calm));
  return upper(p);
}

/** A CSS colour for `pct`: plain ink while there's room, then amber and red. */
export function quietUsageColor(pct: number): string {
  const p = clamp(pct);
  return p < USAGE_STOPS.warn ? INK : upper(p);
}
