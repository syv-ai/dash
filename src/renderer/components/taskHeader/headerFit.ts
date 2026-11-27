/**
 * The task header's labels, in the order they give way as the header narrows:
 * the token count first, the pull request last. `linked` (the task's issue
 * badges) isn't in the user's list; it goes just before the branch.
 */
export const HEADER_LABELS = ['tokens', 'model', 'linked', 'branch', 'pr'] as const;
export type HeaderLabel = (typeof HEADER_LABELS)[number];

/** The flex gap between the header's items (`gap-2.5`). */
export const HEADER_GAP_PX = 10;

/** The task name keeps this much (or its whole width, if less) before any
 *  label hides; past that it truncates. */
export const NAME_MIN_PX = 128;

/** Room left over beyond the shown labels, so they never butt into each
 *  other across the spacer between the left and right groups. */
export const HEADER_COMFORT_PX = 16;

/**
 * How many labels to hide, in `HEADER_LABELS` order, so the rest fit
 * `available` beside the task name at `min(name, NAME_MIN_PX)`. `widths` are
 * the labels' natural widths in that order; 0 is a label that isn't there
 * (it costs no gap). All of them when even the last alone doesn't fit.
 */
export function hiddenLabelCount(
  available: number,
  nameWidth: number,
  widths: readonly number[],
): number {
  const name = Math.min(nameWidth, NAME_MIN_PX);
  const cost = (w: number) => (w > 0 ? w + HEADER_GAP_PX : 0);
  for (let hidden = 0; hidden < widths.length; hidden++) {
    const labels = widths.slice(hidden).reduce((sum, w) => sum + cost(w), 0);
    // Half a pixel of slack: layout widths are fractional, client widths not.
    if (name + labels + HEADER_COMFORT_PX <= available + 0.5) return hidden;
  }
  return widths.length;
}

/** `useFittedDensity`'s pick: `needs` holds the name's width, then the
 *  labels' in `HEADER_LABELS` order. */
export const fitTaskHeader = (available: number, needs: readonly number[]): number =>
  hiddenLabelCount(available, needs[0] ?? 0, needs.slice(1));

/** Whether `label` shows when the first `hidden` labels have given way. */
export const labelShows = (label: HeaderLabel, hidden: number): boolean =>
  HEADER_LABELS.indexOf(label) >= hidden;
