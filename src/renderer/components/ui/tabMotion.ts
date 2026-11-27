import * as React from 'react';
import { EASE, MOTION_MS, reducedMotion } from '../../lib/motion';

/*
 * How a tab switch moves: the selected tab's indicator glides from the old
 * tab to the new (`TabIndicator`), and the incoming view slides in a short
 * way from the side of travel while it fades in (`useSlideIn`): picking a
 * tab to the right brings the view in from the right, moving left. Both
 * calm (U6): the indicator `MOTION_MS.calm`, the view `MOTION_MS.slow`, so
 * it settles in after the indicator, on `EASE.settle`. The editor's code
 * never slides (U6): a page of code moving sideways is dizzying, so its
 * file settles in place (`EditorViewport`) while only the indicator glides.
 * Both run on
 * the compositor (Web Animations on `translate`, `opacity`; the indicator's
 * `width`, on a small box) and skip under reduced motion.
 */

/** The indicator's glide. */
export const TAB_SLIDE_MS = MOTION_MS.calm;
/** The incoming view's slide and fade: longer than the indicator's, so a
 *  view settles in rather than flashing in. */
export const PANE_SLIDE_MS = MOTION_MS.slow;
/** How far (px) the incoming view travels: a nudge, no more. */
export const PANE_SLIDE_PX = 8;
/** The opacity it fades in from: never clear, so the swap isn't a blink. */
export const PANE_FADE_FROM = 0.3;

/** Which way a switch travels in `order`: +1 to a tab further on, -1 back,
 *  0 when either isn't one of its tabs (a closed tab, another task's) or
 *  nothing moved. Only a switch between two tabs of the same strip slides. */
export function slideDirection<T>(order: readonly T[], from: T, to: T): -1 | 0 | 1 {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return 0;
  return b > a ? 1 : -1;
}

/**
 * Slides `ref`'s element in when `value` changes to another tab of `order`
 * (see `slideDirection`): from `PANE_SLIDE_PX` on the side of travel, and
 * from `PANE_FADE_FROM`, to where it lays out. It only moves the element;
 * whatever it holds stays mounted. Its first value, and a switch from or to
 * anything not in `order`, show at once.
 */
export function useSlideIn<T>(
  ref: React.RefObject<HTMLElement | null>,
  value: T,
  order: readonly T[],
): void {
  const was = React.useRef(value);
  React.useLayoutEffect(() => {
    const from = was.current;
    was.current = value;
    const el = ref.current;
    const dir = slideDirection(order, from, value);
    if (!el || dir === 0 || reducedMotion()) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { translate: `${dir * PANE_SLIDE_PX}px 0`, opacity: PANE_FADE_FROM },
        { translate: '0 0', opacity: 1 },
      ],
      { duration: PANE_SLIDE_MS, easing: EASE.settle },
    );
    // Only a change of tab moves it, not a change of the strip's tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
