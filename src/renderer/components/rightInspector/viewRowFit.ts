/** The view row's end, in px: Details (24), the row's two 2px gaps and its
 *  4px end padding. */
export const VIEW_ROW_END_PX = 24 + 2 * 2 + 4;
/** The middle's padding (8), which keeps its focus rings inside its clip; it
 *  stays when the middle is empty. */
export const VIEW_ROW_MIDDLE_PAD_PX = 8;
/** The list column's gutter around the row (8). */
const LIST_GUTTER_PX = 8;

/** The list column's least width: the view tabs at their least (the corner
 *  inset and labels, no counts), the empty middle, the row's end and the
 *  gutter. */
export function viewRowMinPx(tabsMinPx: number): number {
  return tabsMinPx + VIEW_ROW_MIDDLE_PAD_PX + VIEW_ROW_END_PX + LIST_GUTTER_PX;
}

/**
 * How many of the row's middle items show, by the room left once the tabs are
 * at their least (they drop their counts first, flex-shrinking ahead of the
 * middle): the items give way whole, last first, never clipping
 * under Details. `needs[i]`: the middle's natural width (padding included)
 * with its first `needs.length - i` items.
 */
export function fitExtras(room: number, needs: readonly number[]): number {
  const i = needs.findIndex((w) => w <= room + 0.5);
  return i === -1 ? 0 : needs.length - i;
}
