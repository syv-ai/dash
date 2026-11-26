/** The view row's gap between its parts (tabs, middle, end) and between the
 *  middle's items: 2px. */
const GAP_PX = 2;
/** Details, the row's end: a 24px icon button. */
const DETAILS_PX = 24;
/** The row's end padding (4). */
const END_PAD_PX = 4;
/** The view row's end, in px: Details (24), the row's two 2px gaps and its
 *  4px end padding. */
export const VIEW_ROW_END_PX = DETAILS_PX + 2 * GAP_PX + END_PAD_PX;
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

/** What the row shows besides its tabs. */
export interface ViewRowFit {
  /** Per extra, in their order: shown. */
  extras: boolean[];
  details: boolean;
}

/**
 * What the view row shows beside its tabs, at their least (they drop their
 * counts first, flex-shrinking ahead of the rest), in `rowPx`: in order of
 * keeping (the extras, then Details; Details first while it is the view
 * shown, `detailsShown`), each that still fits whole beside those kept before
 * it. So Details gives way before the extras (R9), and a wide extra that
 * doesn't fit doesn't take a narrower one after it down with it. The
 * sidebar is kept wide enough for the tabs and Details alone
 * (`viewRowMinPx`). `extraPx[i]`: extra i's natural width.
 */
export function fitViewRow(
  rowPx: number,
  tabsMinPx: number,
  extraPx: readonly number[],
  detailsShown: boolean,
): ViewRowFit {
  // Half a pixel of slack: layout widths are fractional, client widths not.
  let room = rowPx - tabsMinPx - GAP_PX - VIEW_ROW_MIDDLE_PAD_PX - END_PAD_PX + 0.5;
  const take = (px: number) => {
    if (px > room) return false;
    room -= px;
    return true;
  };
  let details = false;
  const takeDetails = () => (details = take(GAP_PX + DETAILS_PX));
  if (detailsShown) takeDetails();
  let inMiddle = 0;
  const extras = extraPx.map((px) => {
    const kept = take(px + (inMiddle > 0 ? GAP_PX : 0));
    if (kept) inMiddle++;
    return kept;
  });
  if (!detailsShown) takeDetails();
  return { extras, details };
}
