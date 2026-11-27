import * as React from 'react';
import { cn } from '../../lib/cn';
import { EASE, reducedMotion } from '../../lib/motion';
import { TAB_SLIDE_MS } from './tabMotion';

/** The selected tab among a strip's: a shown one, not a measuring copy. */
const SELECTED = '[role="tab"][aria-selected="true"]:not([aria-hidden] *)';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const same = (a: Box | null, b: Box | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** The layout fields `boxIn` reads: an `HTMLElement`'s, so a test can fake one. */
export interface LaidOut {
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
  offsetParent: unknown;
  clientLeft: number;
  clientTop: number;
  scrollLeft: number;
  scrollTop: number;
}

/**
 * Where `tab` lays out in `host`'s padding box, scrolled content included:
 * its offsets summed up the offset-parent chain to `host`. Layout, not
 * `getBoundingClientRect`, so no transform counts: not a tab's own entrance
 * (`drawer-tab-in` rises 4px), and not one it is caught in mid-way, either
 * of which the surface would keep once it ended (a transform fires no
 * `ResizeObserver`). Whole pixels, as the offsets come.
 */
export function boxIn(host: LaidOut, tab: LaidOut): Box {
  let x = tab.offsetLeft;
  let y = tab.offsetTop;
  let parent = tab.offsetParent as LaidOut | null;
  // A positioned box between them: its own place, its border, less its scroll.
  while (parent && parent !== host) {
    x += parent.offsetLeft + parent.clientLeft - parent.scrollLeft;
    y += parent.offsetTop + parent.clientTop - parent.scrollTop;
    parent = parent.offsetParent as LaidOut | null;
  }
  return { x, y, w: tab.offsetWidth, h: tab.offsetHeight };
}

const at = (b: Box) => ({ translate: `${b.x}px ${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });

/** Where a sliding surface shows right now. */
function midway(el: HTMLElement) {
  const { translate, width, height } = getComputedStyle(el);
  return { translate, width, height };
}

/**
 * A strip's selected-tab surface, one box that slides from tab to tab: the
 * tabs draw no selected surface of their own (their shape's `indicated`), and
 * this, laid under them, takes the selected tab's box. Render it as the
 * strip's first child; the selected tab is found among its parent's
 * (`role="tab"`, `aria-selected`, outside `aria-hidden` measuring copies),
 * and placed against its containing block (the nearest positioned ancestor;
 * a strip that scrolls must be one, so the surface scrolls with its tabs).
 *
 * `active` names the selected tab: when it changes, the surface slides
 * (`TAB_SLIDE_MS`, `EASE.settle`); any other move (a resize, a tab's width) it
 * follows at once. `className` is the shape's look (`folderIndicator`,
 * `pillIndicator`, `pillTabIndicator`).
 */
export function TabIndicator({ active, className }: { active: unknown; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const shown = React.useRef<{ active: unknown; box: Box | null }>({ active, box: null });

  const place = React.useCallback((next: unknown) => {
    const el = ref.current;
    if (!el) return;
    const host = el.offsetParent;
    const tab = el.parentElement?.querySelector<HTMLElement>(SELECTED);
    const was = shown.current;
    if (!(host instanceof HTMLElement) || !tab) {
      el.style.visibility = 'hidden';
      shown.current = { active: next, box: null };
      return;
    }
    const box = boxIn(host, tab);
    if (was.active === next && same(was.box, box)) return;
    Object.assign(el.style, at(box), { visibility: 'visible' });
    shown.current = { active: next, box };
    if (was.active === next || !was.box || reducedMotion()) return;
    // From where it shows (mid-slide, where that slide has got to); the end
    // is wherever it lays out, so a resize mid-slide lands right.
    const running = el.getAnimations();
    const from = running.length > 0 ? midway(el) : at(was.box);
    running.forEach((a) => a.cancel());
    el.animate([{ ...from, offset: 0 }], { duration: TAB_SLIDE_MS, easing: EASE.settle });
  }, []);

  // Every render: the strip's tabs may have moved or changed.
  React.useLayoutEffect(() => place(active));

  // A move without a render: the strip (shown again, resized) or the
  // selected tab resizing. It follows at once.
  React.useEffect(() => {
    const el = ref.current;
    const strip = el?.parentElement;
    if (!el || !strip) return;
    const ro = new ResizeObserver(() => place(shown.current.active));
    ro.observe(strip);
    if (el.offsetParent && el.offsetParent !== strip) ro.observe(el.offsetParent);
    const tab = strip.querySelector(SELECTED);
    if (tab) ro.observe(tab);
    return () => ro.disconnect();
  }, [active, place]);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('pointer-events-none invisible absolute top-0 left-0', className)}
    />
  );
}
