import { describe, it, expect } from 'vitest';
import type { ActivityInfo, ActivityState } from '../../../shared/types';
import { MIN_BUSY_DURATION_MS, emptyTracker, observeActivity } from '../activityTransitions';

const update = (m: Record<string, ActivityState>): Record<string, ActivityInfo> =>
  Object.fromEntries(Object.entries(m).map(([id, state]) => [id, { state }]));

/** Feed updates `[time, states]` in order; returns every update's result. */
function run(steps: Array<[number, Record<string, ActivityState>]>) {
  let tracker = emptyTracker();
  return steps.map(([t, states]) => {
    const r = observeActivity(tracker, update(states), t);
    tracker = r.tracker;
    return r;
  });
}

describe('observeActivity', () => {
  it('finishes a turn that went busy → idle', () => {
    const r = run([
      [0, { a: 'idle' }],
      [1, { a: 'busy' }],
      [1 + MIN_BUSY_DURATION_MS, { a: 'idle' }],
    ]);
    expect(r[2]!.finished).toEqual(['a']);
  });

  // The user stopped it (S2): seen, so neither flagged unseen nor chimed.
  it('does not finish a turn the user interrupted', () => {
    let tracker = emptyTracker();
    tracker = observeActivity(tracker, { a: { state: 'busy' } }, 0).tracker;
    const r = observeActivity(
      tracker,
      { a: { state: 'idle', interrupted: true } },
      MIN_BUSY_DURATION_MS,
    );
    expect(r.finished).toEqual([]);
  });

  it('finishes a task first seen busy (Dash opened or reloaded mid-turn)', () => {
    const r = run([
      [0, { a: 'busy' }],
      [MIN_BUSY_DURATION_MS, { a: 'idle' }],
    ]);
    expect(r[1]!.finished).toEqual(['a']);
  });

  it('ignores a busy flash', () => {
    const r = run([
      [0, { a: 'idle' }],
      [1, { a: 'busy' }],
      [MIN_BUSY_DURATION_MS, { a: 'idle' }],
    ]);
    expect(r[2]!.finished).toEqual([]);
  });

  it('times a busy spell from when it began, not from the last update', () => {
    const r = run([
      [0, { a: 'busy' }],
      [MIN_BUSY_DURATION_MS - 1, { a: 'busy', b: 'idle' }],
      [MIN_BUSY_DURATION_MS, { a: 'idle', b: 'idle' }],
    ]);
    expect(r[2]!.finished).toEqual(['a']);
  });

  it('counts idle → busy as a start, and nothing else', () => {
    const r = run([
      [0, { a: 'idle', b: 'waiting' }],
      [1, { a: 'busy', b: 'busy' }],
    ]);
    expect(r[1]!.started).toEqual(['a']);
  });
});
