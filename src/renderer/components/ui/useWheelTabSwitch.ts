import * as React from 'react';

/*
 * A sideways scroll over a tabbed surface (its tab strip, or the view under
 * it) switches to the next or previous tab, one tab per gesture. A trackpad
 * fires a stream of small wheel events (and a momentum tail after the
 * fingers lift), so the core sums the sideways travel to a threshold, steps
 * once, and then holds (the latch) until the stream goes quiet.
 *
 * A gesture has one owner, settled by its first moving event and kept until
 * it goes quiet: a vertical start is a scroll (it never switches, however it
 * drifts); a sideways start over something that can still scroll that way
 * (a wide file, a table) is that scroller's, to its edge and no further (the
 * momentum hitting the edge doesn't switch); any other sideways start is the
 * tabs'. So a fresh sideways gesture over a scroller already at its edge
 * switches, as a browser's history swipe does. Pure; the hook feeds it the
 * surface's wheel events.
 */

/** The sideways travel (px) a gesture needs before it steps. */
export const WHEEL_STEP_PX = 40;
/** The quiet (ms) that ends a gesture: a momentum tail's events come every
 *  frame or so, so a gap this long is the fingers having stopped. */
export const WHEEL_GAP_MS = 160;

/** Whose a gesture is: the tabs' (it may switch), a nested scroller's, or a
 *  vertical scroll's (neither switches). */
export type WheelOwner = 'tabs' | 'scroller' | 'vertical';

export interface WheelState {
  /** The sideways travel summed since the gesture began (or last stepped). */
  travel: number;
  /** Stepped already in this gesture: hold until it goes quiet. */
  latched: boolean;
  /** When the last wheel event came; -Infinity before any. */
  at: number;
  /** The gesture's owner; null until its first moving event. */
  owner: WheelOwner | null;
}

export const WHEEL_IDLE: WheelState = { travel: 0, latched: false, at: -Infinity, owner: null };

/** One wheel event, deltas in px. */
export interface WheelInput {
  dx: number;
  dy: number;
  /** Its time, ms. */
  t: number;
  /** Whether a scroller under the pointer, inside the surface, can still
   *  move along `dx`. Asked only of a gesture's first sideways event. */
  nested?: () => boolean;
}

/** The next state; the step it makes (+1 the next tab, -1 the previous, 0
 *  none; positive `dx`, scrolling right, is the next tab); and whether the
 *  surface takes the event (the tabs own the gesture: nothing under it
 *  scrolls). */
export function wheelTabStep(
  state: WheelState,
  { dx, dy, t, nested }: WheelInput,
): { state: WheelState; step: -1 | 0 | 1; take: boolean } {
  // A quiet gap ends the gesture before this event starts the next one.
  const was = t - state.at > WHEEL_GAP_MS ? WHEEL_IDLE : state;
  if (dx === 0 && dy === 0) {
    return { state: { ...was, at: t }, step: 0, take: was.owner === 'tabs' };
  }
  const owner: WheelOwner =
    was.owner ?? (!isSideways(dx, dy) ? 'vertical' : nested?.() ? 'scroller' : 'tabs');
  if (owner !== 'tabs') return { state: { ...WHEEL_IDLE, owner, at: t }, step: 0, take: false };
  const hold = { owner, latched: was.latched, at: t };
  // Not sideways (it adds no travel), or stepped already.
  if (!isSideways(dx, dy) || was.latched) {
    return { state: { ...hold, travel: 0 }, step: 0, take: true };
  }
  // A turn of direction starts the travel over.
  const before = Math.sign(was.travel) !== Math.sign(dx) ? 0 : was.travel;
  const travel = before + dx;
  if (Math.abs(travel) < WHEEL_STEP_PX) {
    return { state: { ...hold, travel }, step: 0, take: true };
  }
  return {
    state: { owner, travel: 0, latched: true, at: t },
    step: travel > 0 ? 1 : -1,
    take: true,
  };
}

/** Whether a wheel event is sideways-dominant (one the strip may take). */
export const isSideways = (dx: number, dy: number) => Math.abs(dx) > Math.abs(dy);

/** The tab `step` places from `current` in `order`; undefined past either
 *  end (no wrap) or when `current` isn't in it. */
export function stepTab<T>(order: readonly T[], current: T, step: -1 | 1): T | undefined {
  const i = order.indexOf(current);
  if (i < 0) return undefined;
  return order[i + step];
}

/** A wheel event's deltas in px (`deltaMode` lines or pages, scaled). */
function pixels(e: WheelEvent, page: number): { dx: number; dy: number } {
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1;
  return { dx: e.deltaX * scale, dy: e.deltaY * scale };
}

/** Whether `el` scrolls sideways itself (it overflows its scroll box). */
function scrollsSideways(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false;
  const { overflowX } = getComputedStyle(el);
  return overflowX === 'auto' || overflowX === 'scroll';
}

/** Whether a natively scrolling `el` can still move along `dx`. */
function scrollsAlong(el: Element, dx: number): boolean {
  if (!scrollsSideways(el)) return false;
  return dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
}

/** For content that scrolls itself rather than natively (Monaco): whether
 *  `el`, if it is such a scroller, can still move along `dx`. */
export type ScrollProbe = (el: Element, dx: number) => boolean;

/** Marks a surface that switches on the wheel: the innermost one under the
 *  pointer takes a gesture, so a nested surface's (the Agent tab's
 *  Scratchpad | Memory) never also switches the one around it. */
const SURFACE = 'data-wheel-tabs';

/**
 * Switches tabs on a sideways scroll over `ref`'s element: a tab strip, or
 * the view under it. `onStep` gets +1 (the next tab) or -1 once per gesture.
 * A gesture that starts over a nested scroller that can still move that way
 * (natively, or by `probe`) is left to it (see `wheelTabStep`); a strip
 * that overflows and scrolls sideways itself keeps the wheel for its scroll
 * and never switches.
 *
 * It listens in the capture phase: Monaco and xterm stop the wheel events
 * they see from bubbling, so a view's content would otherwise never let one
 * through; and a gesture the tabs own stops there, so nothing under it
 * scrolls (or, in a terminal, turns into arrow keys).
 */
export function useWheelTabSwitch(
  ref: React.RefObject<HTMLElement | null>,
  onStep: (step: -1 | 1) => void,
  probe?: ScrollProbe,
): void {
  const onStepRef = React.useRef(onStep);
  const probeRef = React.useRef(probe);
  React.useLayoutEffect(() => {
    onStepRef.current = onStep;
    probeRef.current = probe;
  });
  // The strip can unmount and remount under the same ref (the drawer's tabs
  // render only while it's open), so re-check the element after every render
  // and move the listener when it changed, rather than binding once on mount.
  const bound = React.useRef<{ el: HTMLElement; detach: () => void } | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (bound.current?.el === el) return;
    bound.current?.detach();
    bound.current = el ? { el, detach: listen(el, onStepRef, probeRef) } : null;
  });
  React.useEffect(
    () => () => {
      bound.current?.detach();
      bound.current = null;
    },
    [],
  );
}

function listen(
  el: HTMLElement,
  onStepRef: React.RefObject<(step: -1 | 1) => void>,
  probeRef: React.RefObject<ScrollProbe | undefined>,
): () => void {
  let state = WHEEL_IDLE;
  const onWheel = (e: WheelEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    // A surface nested in this one takes it.
    if (target?.closest(`[${SURFACE}]`) !== el) return;
    if (scrollsSideways(el)) return;
    const { dx, dy } = pixels(e, el.clientWidth);
    const nested = () => {
      for (let n: Element | null = target; n && n !== el; n = n.parentElement) {
        if (probeRef.current?.(n, dx) || scrollsAlong(n, dx)) return true;
      }
      return false;
    };
    const next = wheelTabStep(state, { dx, dy, t: e.timeStamp, nested });
    state = next.state;
    if (next.take) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (next.step !== 0) onStepRef.current(next.step);
  };
  el.setAttribute(SURFACE, '');
  el.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => {
    el.removeAttribute(SURFACE);
    el.removeEventListener('wheel', onWheel, { capture: true });
  };
}
