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
