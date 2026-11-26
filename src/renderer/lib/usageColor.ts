/*
 * The colour of a usage level, where more is worse: the done green up to
 * 40 %, easing to the warn amber at 65 % and on to the fail red at 100 %.
 * It mixes the role tokens in OKLCH (perceptually even, no muddy midpoint),
 * so it follows the theme like any token does.
 */

/** Where the colour starts to move, turns yellow, and reaches red (%). */
export const USAGE_STOPS = { calm: 40, warn: 65, full: 100 } as const;

const DONE = 'hsl(var(--state-done))';
const WARN = 'hsl(var(--warn))';
const FAIL = 'hsl(var(--state-fail))';

/** `b` mixed into `a` by `t` (0–1), one decimal of a percent. */
function mix(a: string, b: string, t: number): string {
  const share = Math.round(t * 1000) / 10;
  return `color-mix(in oklch, ${b} ${share}%, ${a})`;
}

/** A CSS colour for `pct` (0–100, clamped; NaN reads as 0). */
export function usageColor(pct: number): string {
  const p = Number.isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
  const { calm, warn, full } = USAGE_STOPS;
  if (p <= calm) return DONE;
  if (p < warn) return mix(DONE, WARN, (p - calm) / (warn - calm));
  if (p === warn) return WARN;
  if (p < full) return mix(WARN, FAIL, (p - warn) / (full - warn));
  return FAIL;
}
