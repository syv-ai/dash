import * as React from 'react';

/*
 * How a tab switch moves: the selected tab's indicator slides from the old
 * tab to the new (`TabIndicator`), and the incoming content slides in a
 * short way from the side of travel while it fades in (`useSlideIn`):
 * picking a tab to the right brings the content in from the right, moving
 * left. Both ease out: the indicator short (`ease-panel`), so a switch never
 * feels slow; the content calmer, so it never reads as a flash.
 * Both run on the compositor (Web Animations on `translate`, `opacity`; the
 * indicator's `width`, on a small box) and skip under reduced motion.
 */

/** The indicator's slide. */
export const TAB_SLIDE_MS = 200;
/** The incoming content's slide and fade: longer than the indicator's and
 *  on a gentler curve (`PANE_EASE`), so a view settles in rather than
 *  flashing in (at 180ms on `ease-panel`, from clear, it read as a flash). */
export const PANE_SLIDE_MS = 280;
/** How far (px) the incoming content travels. */
export const PANE_SLIDE_PX = 10;
/** The opacity it fades in from: never clear, so the swap isn't a blink. */
export const PANE_FADE_FROM = 0.3;
/** Its curve: an ease-out (quadratic), gentler than `ease-panel`'s cubic,
 *  which spends most of its travel in the first frames. */
export const PANE_EASE = 'cubic-bezier(0.5, 1, 0.89, 1)';

/** Which way a switch travels in `order`: +1 to a tab further on, -1 back,
 *  0 when either isn't one of its tabs (a closed tab, another task's) or
 *  nothing moved. Only a switch between two tabs of the same strip slides. */
export function slideDirection<T>(order: readonly T[], from: T, to: T): -1 | 0 | 1 {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return 0;
  return b > a ? 1 : -1;
}

/** The ease-out curve as Web Animations takes it: `ease-panel`'s value from
 *  `index.css` (a `var()` can't be an animation's easing). */
let panelEasing: string | undefined;
export function easeOut(): string {
  panelEasing ??=
    getComputedStyle(document.documentElement).getPropertyValue('--ease-panel').trim() ||
    'ease-out';
  return panelEasing;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What a slide waits for before it plays: it calls `go` once the incoming
 *  content shows, and returns a cancel. */
export type SlideReady = (el: HTMLElement, go: () => void) => () => void;

/**
 * Slides `ref`'s element in when `value` changes to another tab of `order`
 * (see `slideDirection`): from `PANE_SLIDE_PX` on the side of travel, and
 * from `PANE_FADE_FROM`, to where it lays out. It only moves the element; whatever it
 * holds stays mounted. Its first value, and a switch from or to anything not
 * in `order`, show at once.
 *
 * `fade: false` leaves its opacity alone, for content that fades itself in
 * once it has swapped; `ready` holds the slide until then, so it never moves
 * the outgoing content.
 */
export function useSlideIn<T>(
  ref: React.RefObject<HTMLElement | null>,
  value: T,
  order: readonly T[],
  { fade = true, ready }: { fade?: boolean; ready?: SlideReady } = {},
): void {
  const was = React.useRef(value);
  React.useLayoutEffect(() => {
    const from = was.current;
    was.current = value;
    const el = ref.current;
    const dir = slideDirection(order, from, value);
    if (!el || dir === 0 || reducedMotion()) return;
    const go = () => {
      el.getAnimations().forEach((a) => a.cancel());
      el.animate(
        [
          { translate: `${dir * PANE_SLIDE_PX}px 0`, ...(fade && { opacity: PANE_FADE_FROM }) },
          { translate: '0 0', ...(fade && { opacity: 1 }) },
        ],
        { duration: PANE_SLIDE_MS, easing: PANE_EASE },
      );
    };
    if (!ready) return go();
    return ready(el, go);
    // Only a change of tab moves it, not a change of the strip's tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
