/** The left sidebar's panel, as a motion reads it: its width (px) at the
 *  layout it is heading to, and whether that is its rail. */
export interface LeftPanelSize {
  px: number;
  collapsed: boolean;
}

/** The left sidebar crossing between its rail and its content in an ease:
 *  the content is held at its expanded width (`width`, px), clipped by the
 *  panel, so it never lays out at the widths in between, and fades in
 *  (`to: 'expanded'`) or out (`'collapsed'`). */
export interface LeftHold {
  width: number;
  to: 'expanded' | 'collapsed';
}

/** The hold for a move of the left sidebar from `before` to `after`, if it
 *  crosses between its rail and its content. */
export function leftHoldOf(before: LeftPanelSize, after: LeftPanelSize): LeftHold | undefined {
  if (before.collapsed === after.collapsed) return undefined;
  return {
    width: Math.round(Math.max(before.px, after.px)),
    to: after.collapsed ? 'collapsed' : 'expanded',
  };
}
