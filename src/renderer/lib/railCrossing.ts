/*
 * A panel's content crossing to or from its rail (the left sidebar's, the
 * task sidebar's, the expanded list column's) while the panel eases: held at
 * its open width, clipped by the panel, so its fitted rows never lay out at
 * the widths in between, and fading in as it opens or out as it closes; the
 * rail fades in once it has closed (`ui/HeldFrame`).
 */

/** A panel as a crossing reads it: its width (px) at the layout it is
 *  heading to, and whether that is its rail. */
export interface PanelExtent {
  px: number;
  collapsed: boolean;
}

/** Content held at `width` (px) while its panel eases; `fade`: in as it
 *  opens from its rail, out as it closes to it, none when it only resizes. */
export interface Held {
  width: number;
  fade?: 'in' | 'out';
}

/** The hold for a move from `before` to `after`, if it crosses between the
 *  rail and the content: at the open one's width. */
export function heldAcrossRail(before: PanelExtent, after: PanelExtent): Held | undefined {
  if (before.collapsed === after.collapsed) return undefined;
  return {
    width: Math.round(Math.max(before.px, after.px)),
    fade: after.collapsed ? 'out' : 'in',
  };
}

/** How far past its rail a drag out must end to open the panel (px): a
 *  press that barely moves leaves it railed. */
export const RAIL_DRAG_SLOP_PX = 4;

/**
 * Where a drag out of the rail settles once released (X2), the panel having
 * followed the pointer from the rail (`px`, its width at release): back to
 * the rail if it ended within `slopPx` of it, else open, at least `minPx`
 * (a width short of it snaps to it, one past it is kept).
 */
export function railDragEnd({
  px,
  railPx,
  minPx,
  slopPx = RAIL_DRAG_SLOP_PX,
}: {
  px: number;
  railPx: number;
  minPx: number;
  slopPx?: number;
}): { open: false } | { open: true; px: number } {
  if (px < railPx + slopPx) return { open: false };
  return { open: true, px: Math.round(Math.max(px, minPx)) };
}
