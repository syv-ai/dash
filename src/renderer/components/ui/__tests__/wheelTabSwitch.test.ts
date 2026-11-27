import { describe, expect, it } from 'vitest';
import {
  WHEEL_GAP_MS,
  WHEEL_IDLE,
  WHEEL_STEP_PX,
  stepTab,
  wheelTabStep,
  type WheelInput,
  type WheelState,
} from '../useWheelTabSwitch';

/** Feeds events in order; the steps they make. */
function run(events: WheelInput[], from: WheelState = WHEEL_IDLE) {
  let state = from;
  const steps: number[] = [];
  const taken: boolean[] = [];
  for (const e of events) {
    const next = wheelTabStep(state, e);
    state = next.state;
    taken.push(next.take);
    if (next.step !== 0) steps.push(next.step);
  }
  return { steps, state, taken };
}

/** A trackpad stream: `n` events `dx` apart by 16ms from `t0`. */
const stream = (n: number, dx: number, t0 = 0, dy = 0, nested?: () => boolean): WheelInput[] =>
  Array.from({ length: n }, (_, i) => ({ dx, dy, t: t0 + i * 16, nested }));

const after = (events: WheelInput[], gap = 16) => events.at(-1)!.t + gap;

describe('wheelTabStep', () => {
  it('steps once the sideways travel reaches the threshold', () => {
    const below = run(stream(3, (WHEEL_STEP_PX - 1) / 3));
    expect(below.steps).toEqual([]);
    expect(run(stream(4, WHEEL_STEP_PX / 4)).steps).toEqual([1]);
  });

  it('steps back on leftward travel', () => {
    expect(run(stream(2, -WHEEL_STEP_PX)).steps).toEqual([-1]);
  });

  it('moves one tab per gesture, momentum tail included', () => {
    expect(run(stream(60, 30)).steps).toEqual([1]);
  });

  it('lets a new gesture step again after a quiet gap', () => {
    const first = stream(10, 30);
    const second = stream(10, 30, first.at(-1)!.t + WHEEL_GAP_MS + 1);
    expect(run([...first, ...second]).steps).toEqual([1, 1]);
  });

  it('ignores vertical-dominant events', () => {
    expect(run(stream(20, 30, 0, 31)).steps).toEqual([]);
  });

  it('starts the travel over when the direction turns', () => {
    expect(run([...stream(1, 30), ...stream(1, -30, 16), ...stream(1, 30, 32)]).steps).toEqual([]);
  });

  it('never switches in a gesture that starts vertical, however it drifts', () => {
    const down = stream(3, 0, 0, 20);
    const { steps, taken } = run([...down, ...stream(20, 30, after(down))]);
    expect(steps).toEqual([]);
    expect(taken.every((t) => !t)).toBe(true);
  });

  it('waits for a moving event to settle the owner', () => {
    expect(run([{ dx: 0, dy: 0, t: 0 }, ...stream(4, 20, 16)]).steps).toEqual([1]);
  });

  it('leaves a gesture to a nested scroller that can move that way, to its edge', () => {
    let room = 3;
    // The scroller runs out of room mid-gesture: the momentum doesn't switch.
    const nested = () => room-- > 0;
    const { steps, taken } = run(stream(30, 30, 0, 0, nested));
    expect(steps).toEqual([]);
    expect(taken.every((t) => !t)).toBe(true);
  });

  it('asks the nested scroller only at the start of a gesture', () => {
    let asked = 0;
    const nested = () => (asked++, false);
    run(stream(30, 30, 0, 0, nested));
    expect(asked).toBe(1);
  });

  it('switches on a fresh gesture once the nested scroller is at its edge', () => {
    const first = stream(10, 30, 0, 0, () => true);
    const second = stream(10, 30, after(first, WHEEL_GAP_MS + 1), 0, () => false);
    expect(run([...first, ...second]).steps).toEqual([1]);
  });

  it('takes every event of a gesture the tabs own, vertical drift included', () => {
    const { taken } = run([...stream(4, 30), ...stream(2, 1, 64, 10)]);
    expect(taken.every(Boolean)).toBe(true);
  });

  it('drops travel left over from an earlier gesture', () => {
    const { state } = run(stream(1, WHEEL_STEP_PX - 1));
    expect(run([{ dx: 2, dy: 0, t: WHEEL_GAP_MS + 1 }], state).steps).toEqual([]);
  });
});

/*
 * A modelled macOS trackpad swipe, since a real one can't be captured here
 * (no trackpad on the test machine): the fingers' phase ramps up and eases
 * off over ~8 events, then AppKit's momentum tail decays exponentially
 * (x0.95 per 16ms frame) for about a second, with no gap anywhere near
 * WHEEL_GAP_MS. Touching the pad again cancels the tail and the next swipe's
 * events follow at once.
 */
const FINGERS = [2, 5, 9, 14, 18, 20, 18, 15];
function swipe(t0: number, sign = 1, tailMs = 1200): WheelInput[] {
  const out: WheelInput[] = FINGERS.map((d, i) => ({ dx: sign * d, dy: 0, t: t0 + i * 12 }));
  const lift = out.at(-1)!.t;
  for (let d = FINGERS.at(-1)! * 0.95, t = lift + 16; t - lift < tailMs; d *= 0.95, t += 16) {
    out.push({ dx: (sign * Math.round(d * 10)) / 10, dy: 0, t });
  }
  return out;
}
/** A swipe whose momentum is cut `ms` into its tail by the next swipe. */
const cut = (events: WheelInput[], ms: number) => {
  const end = events[FINGERS.length - 1]!.t + ms;
  return events.filter((e) => e.t <= end);
};

describe('wheelTabStep on a trackpad trace', () => {
  it('steps once for one swipe, its whole momentum tail included', () => {
    expect(run(swipe(0)).steps).toEqual([1]);
  });

  it('steps again for a swipe that starts while the last one still coasts', () => {
    for (const ms of [150, 400, 800]) {
      const first = cut(swipe(0), ms);
      const second = swipe(after(first));
      expect(run([...first, ...second]).steps, `cut ${ms}ms in`).toEqual([1, 1]);
    }
  });

  it('steps for each of several swipes in a row, never quiet in between', () => {
    let t = 0;
    const events: WheelInput[] = [];
    for (let i = 0; i < 4; i++) {
      const s = cut(swipe(t), 300);
      events.push(...s);
      t = after(s);
    }
    expect(run(events).steps).toEqual([1, 1, 1, 1]);
  });

  it('steps back for a swipe the other way during the tail', () => {
    const first = cut(swipe(0), 300);
    expect(run([...first, ...swipe(after(first), -1)]).steps).toEqual([1, -1]);
  });

  it("doesn't step twice for fingers still speeding up after the step", () => {
    const fast = [2, 4, 8, 16, 32, 64, 100, 60, 30].map((dx, i) => ({ dx, dy: 0, t: i * 12 }));
    expect(run(fast).steps).toEqual([1]);
  });

  it("doesn't take coalesced momentum events for a new swipe", () => {
    // A busy main thread (the switched-to view rendering) merges a few
    // frames of the tail into one event: their deltas summed, the last one's
    // time. Bigger deltas, but no faster.
    const tail = swipe(0);
    const merge = (from: number, n: number) => ({
      dx: tail.slice(from, from + n).reduce((sum, e) => sum + e.dx, 0),
      dy: 0,
      t: tail[from + n - 1]!.t,
    });
    const events = [...tail.slice(0, 20), tail[20]!, merge(21, 2), merge(23, 3), ...tail.slice(26)];
    expect(events[22]!.dx).toBeGreaterThan(events[21]!.dx);
    expect(events[21]!.dx).toBeGreaterThan(events[20]!.dx);
    expect(run(events).steps).toEqual([1]);
  });

  it("doesn't take a late frame and its jitter for a new swipe", () => {
    // A replay in the dev instance that stepped twice: one event 65ms late
    // just after the step (the switched-to view rendering), the next ones
    // a little uneven. Gaps in ms before each event, as captured.
    const gaps = [0, 14.7, 13.6, 14.4, 13.8, 80.8, 16.4, 13, 13.5, 17.7, 46.2, 18.6];
    let t = 0;
    const events = swipe(0).map((e, i) => ({ ...e, t: (t += gaps[i] ?? 16.7) }));
    expect(run(events).steps).toEqual([1]);
  });

  it("doesn't take one fat event in the tail for a new swipe", () => {
    const events = swipe(0).map((e, i) => (i === 30 ? { ...e, dx: e.dx * 3 } : e));
    expect(run(events).steps).toEqual([1]);
  });

  it("doesn't take a tail's uneven sizes for a new swipe", () => {
    // Rounding and the pad's noise: a few percent either way, rising twice
    // in a row now and then.
    const wobble = [1, 1.05, 1.1, 0.95, 1, 1.06, 1.12, 0.97];
    const events = swipe(0).map((e, i) =>
      i < FINGERS.length ? e : { ...e, dx: e.dx * wobble[i % 8]! },
    );
    expect(run(events).steps).toEqual([1]);
  });

  it("doesn't take a lifting finger's backward tick for a swipe back", () => {
    const first = swipe(0);
    const lift = FINGERS.length;
    const events = [
      ...first.slice(0, lift),
      { dx: -1, dy: 0, t: first[lift - 1]!.t + 4 },
      ...first.slice(lift),
    ];
    expect(run(events).steps).toEqual([1]);
  });
});

describe('stepTab', () => {
  const order = ['a', 'b', 'c'];
  it('picks the neighbour', () => {
    expect(stepTab(order, 'b', 1)).toBe('c');
    expect(stepTab(order, 'b', -1)).toBe('a');
  });
  it("doesn't wrap, and knows no stranger", () => {
    expect(stepTab(order, 'c', 1)).toBeUndefined();
    expect(stepTab(order, 'a', -1)).toBeUndefined();
    expect(stepTab(order, 'z', 1)).toBeUndefined();
  });
});
