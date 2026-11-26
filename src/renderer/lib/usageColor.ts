/*
 * The colour of a usage level, where more is worse: plain ink while there is
 * room, the warn amber from 65 %, easing on to the fail red at 100 %. One
 * ramp for every usage figure (the limits, the session context, Settings'
 * meters). Below the threshold it stays neutral: green means a live session
 * at rest (S1), not "plenty left" (T19). The ease mixes the role tokens in
 * OKLCH (perceptually even, no muddy midpoint), so it follows the theme like
 * any token does.
 */

/** Where the colour turns amber, and where it reaches red (%). */
export const USAGE_STOPS = { warn: 65, full: 100 } as const;

const CALM = 'hsl(var(--ink))';
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
  const { warn, full } = USAGE_STOPS;
  if (p < warn) return CALM;
  if (p === warn) return WARN;
  if (p < full) return mix(WARN, FAIL, (p - warn) / (full - warn));
  return FAIL;
}
