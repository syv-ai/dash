/** The view row's gap between its parts (tabs, middle, end) and between the
 *  middle's items: 2px. */
const GAP_PX = 2;
/** The row's one icon slot: Details, or an extra's compact form in its
 *  place: a 24px icon button. */
const ICON_SLOT_PX = 24;
/** The row's end padding (4). */
const END_PAD_PX = 4;
/** The view row's end, in px: the icon slot (24), the row's two 2px gaps and
 *  its 4px end padding. */
export const VIEW_ROW_END_PX = ICON_SLOT_PX + 2 * GAP_PX + END_PAD_PX;
/** The middle's padding (8), which keeps its focus rings inside its clip; it
 *  stays when the middle is empty. */
export const VIEW_ROW_MIDDLE_PAD_PX = 8;
/** The list column's gutter around the row (8). */
const LIST_GUTTER_PX = 8;

/** The list column's least width: the view tabs at their least (the corner
 *  inset and labels, no counts), the empty middle, the row's end with its
 *  icon slot, and the gutter. So the slot always holds Details alone, or the
 *  first extra's compact form (R12). */
export function viewRowMinPx(tabsMinPx: number): number {
  return tabsMinPx + VIEW_ROW_MIDDLE_PAD_PX + VIEW_ROW_END_PX + LIST_GUTTER_PX;
}

/** An extra's natural width, and its compact form's (an icon button, no
 *  wider than the icon slot), if it has one. */
export interface ViewRowExtraPx {
  px: number;
  compactPx?: number;
}

/** How an extra shows. */
export type ExtraFit = 'full' | 'compact' | 'hidden';

/** What the row shows besides its tabs. */
export interface ViewRowFit {
  /** Per extra, in their order. */
  extras: ExtraFit[];
  details: boolean;
}

/**
 * What the view row shows beside its tabs, at their least (they drop their
 * counts first, flex-shrinking ahead of the rest), in `rowPx`. The extras, in
 * order of keeping, each in full, else compact, else hidden, in what is left
 * beside those kept before it; so a wide extra that doesn't fit doesn't take
 * a narrower one after it down with it. Details gives way before any extra
 * does: it shows only while every extra shows in full, and never comes back
 * in place of one that gave way (R12). While Details is the view shown
 * (`detailsShown`) it keeps its place ahead of the extras instead.
 */
export function fitViewRow(
  rowPx: number,
  tabsMinPx: number,
  extras: readonly ViewRowExtraPx[],
  detailsShown: boolean,
): ViewRowFit {
  // Half a pixel of slack: layout widths are fractional, client widths not.
  let room = rowPx - tabsMinPx - GAP_PX - VIEW_ROW_MIDDLE_PAD_PX - END_PAD_PX + 0.5;
  const take = (px: number) => {
    if (px > room) return false;
    room -= px;
    return true;
  };
  const takeDetails = () => take(GAP_PX + ICON_SLOT_PX);
  let details = detailsShown && takeDetails();
  let inMiddle = 0;
  const fits = extras.map(({ px, compactPx }): ExtraFit => {
    const gap = inMiddle > 0 ? GAP_PX : 0;
    if (take(px + gap)) {
      inMiddle++;
      return 'full';
    }
    if (compactPx !== undefined && take(compactPx + gap)) {
      inMiddle++;
      return 'compact';
    }
    return 'hidden';
  });
  if (!detailsShown) details = fits.every((f) => f === 'full') && takeDetails();
  return { extras: fits, details };
}
