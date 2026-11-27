import * as React from 'react';

/*
 * A sideways scroll over a tab strip switches to the next or previous tab,
 * one tab per gesture. A trackpad fires a stream of small wheel events (and a
 * momentum tail after the fingers lift), so the core sums the sideways travel
 * to a threshold, steps once, and then holds (the latch) until the stream
 * goes quiet. Only sideways-dominant events count: a vertical scroll over the
 * strip is left alone. Pure; the hook feeds it the strip's wheel events.
 */

/** The sideways travel (px) a gesture needs before it steps. */
export const WHEEL_STEP_PX = 40;
/** The quiet (ms) that ends a gesture: a momentum tail's events come every
 *  frame or so, so a gap this long is the fingers having stopped. */
export const WHEEL_GAP_MS = 160;

export interface WheelState {
  /** The sideways travel summed since the gesture began (or last stepped). */
  travel: number;
  /** Stepped already in this gesture: hold until it goes quiet. */
  latched: boolean;
  /** When the last wheel event came; -Infinity before any. */
  at: number;
}

export const WHEEL_IDLE: WheelState = { travel: 0, latched: false, at: -Infinity };

/** One wheel event, deltas in px. */
export interface WheelInput {
  dx: number;
  dy: number;
  /** Its time, ms. */
  t: number;
}

/** The next state, and the step it makes: +1 the next tab, -1 the previous,
 *  0 none. Positive `dx` (scrolling right) is the next tab. */
export function wheelTabStep(
  state: WheelState,
  { dx, dy, t }: WheelInput,
): { state: WheelState; step: -1 | 0 | 1 } {
  // A quiet gap ends the gesture before this event starts the next one.
  const fresh = t - state.at > WHEEL_GAP_MS;
  const latched = !fresh && state.latched;
  if (Math.abs(dx) <= Math.abs(dy)) {
    // Not sideways: it keeps the gesture alive but adds no travel.
    return { state: { travel: 0, latched, at: t }, step: 0 };
  }
  if (latched) return { state: { travel: 0, latched, at: t }, step: 0 };
  // A turn of direction starts the travel over.
  const before = fresh || Math.sign(state.travel) !== Math.sign(dx) ? 0 : state.travel;
  const travel = before + dx;
  if (Math.abs(travel) < WHEEL_STEP_PX) {
    return { state: { travel, latched: false, at: t }, step: 0 };
  }
  return { state: { travel: 0, latched: true, at: t }, step: travel > 0 ? 1 : -1 };
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

/** A strip that scrolls sideways itself (it overflows its scroll box). */
function scrollsSideways(el: HTMLElement): boolean {
  if (el.scrollWidth <= el.clientWidth) return false;
  const { overflowX } = getComputedStyle(el);
  return overflowX === 'auto' || overflowX === 'scroll';
}

/**
 * Switches tabs on a sideways scroll over `ref`'s element (the tab strip;
 * the content under it keeps its own scroll). `onStep` gets +1 (the next
 * tab) or -1 once per gesture. A strip that overflows and scrolls sideways
 * keeps the gesture for its own scroll: it never switches.
 */
export function useWheelTabSwitch(
  ref: React.RefObject<HTMLElement | null>,
  onStep: (step: -1 | 1) => void,
): void {
  const onStepRef = React.useRef(onStep);
  React.useLayoutEffect(() => {
    onStepRef.current = onStep;
  });
  // The strip can unmount and remount under the same ref (the drawer's tabs
  // render only while it's open), so re-check the element after every render
  // and move the listener when it changed, rather than binding once on mount.
  const bound = React.useRef<{ el: HTMLElement; detach: () => void } | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (bound.current?.el === el) return;
    bound.current?.detach();
    bound.current = el ? { el, detach: listen(el, onStepRef) } : null;
  });
  React.useEffect(
    () => () => {
      bound.current?.detach();
      bound.current = null;
    },
    [],
  );
}

function listen(el: HTMLElement, onStepRef: React.RefObject<(step: -1 | 1) => void>): () => void {
  let state = WHEEL_IDLE;
  const onWheel = (e: WheelEvent) => {
    const { dx, dy } = pixels(e, el.clientWidth);
    if (!isSideways(dx, dy)) return;
    if (scrollsSideways(el)) return;
    // Ours: no page or ancestor scrolls sideways under it.
    e.preventDefault();
    const next = wheelTabStep(state, { dx, dy, t: e.timeStamp });
    state = next.state;
    if (next.step !== 0) onStepRef.current(next.step);
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}
