/*
 * How a mark on a `ScrollRail` is sized, in px: pure, so the rules are tested
 * without a DOM. A mark spans the stretch of the document it stands for, but
 * never draws smaller than a bar you can spot, however long the document.
 */

/** A bar's least drawn height: taller than any lane is wide, so the least
 *  mark still reads as a bar, not a dot. */
export const RAIL_BAR_MIN_PX = 8;
/** A bar's least hit box (taller than it draws, so a short bar is easy to hit). */
export const RAIL_HIT_MIN_PX = 10;

export interface RailRect {
  top: number;
  height: number;
}

/**
 * The drawn box of a mark whose stretch starts at `at` and runs `size`
 * (fractions of the rail's height): its true height, or `minPx` centred on
 * the stretch where that is less, kept inside the rail.
 */
export function railBar(
  at: number,
  size: number,
  railHeight: number,
  minPx: number = RAIL_BAR_MIN_PX,
): RailRect {
  const height = Math.min(Math.max(size * railHeight, minPx), railHeight);
  const middle = (at + size / 2) * railHeight;
  const top = Math.min(Math.max(middle - height / 2, 0), railHeight - height);
  return { top, height };
}
