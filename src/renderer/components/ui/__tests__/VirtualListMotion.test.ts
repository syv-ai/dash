import { describe, it, expect } from 'vitest';
import {
  enterKeyframes,
  exitKeyframes,
  goneRows,
  hideWindow,
  newRows,
  revealWindow,
  sameKeys,
  slideRoom,
  slides,
  type Slot,
} from '../VirtualListMotion';

/** Rows of `size` px stacked from 0, keyed by `keys`. */
const stack = (keys: string[], size = 10): Slot[] =>
  keys.map((key, i) => ({ key, start: i * size, size }));

describe('newRows / revealWindow', () => {
  // A folder `f` opens: its children a, b uncover above `g`, which slides down.
  const after = stack(['f', 'a', 'b', 'g']);
  const listed = new Set(['f', 'g']);
  const rows = newRows(after, (k) => listed.has(k as string));

  it('groups consecutive new rows into one run spanning to the next row', () => {
    expect(rows.map((r) => [r.key, r.runTop, r.runEnd])).toEqual([
      ['a', 10, 30],
      ['b', 10, 30],
    ]);
  });

  it('uncovers each row while the moving edge crosses it, top row first', () => {
    expect(rows.map((r) => revealWindow(r, 1000))).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);
  });

  it('travels no further than the visible bottom, so a tall run is not a blur', () => {
    // Only 10px of the run shows: the first row takes the whole progress.
    expect(rows.map((r) => revealWindow(r, 20))).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});

describe('goneRows / hideWindow', () => {
  const before = stack(['f', 'a', 'b', 'g']);
  const listed = new Set(['f', 'g']);
  const rows = goneRows(before, (k) => listed.has(k as string));

  it('covers bottom-up as the edge moves up: the lower row goes first', () => {
    expect(rows.map((r) => [r.key, hideWindow(r, 1000)])).toEqual([
      ['a', [0.5, 1]],
      ['b', [0, 0.5]],
    ]);
  });

  it('keeps separate runs apart', () => {
    const gone = goneRows(stack(['a', 'x', 'b', 'y']), (k) => k === 'x' || k === 'y');
    expect(gone.map((r) => [r.key, r.runTop, r.runEnd])).toEqual([
      ['a', 0, 10],
      ['b', 20, 30],
    ]);
  });
});

describe('slides', () => {
  const was = new Map([
    ['a', 0],
    ['b', 10],
    ['c', 2000],
  ]);
  const startBefore = (k: React.Key) => was.get(k as string);

  it('slides rows that stayed and moved, from where they were', () => {
    const after = stack(['b', 'a', 'new']);
    expect(slides({ after, startBefore, maxDistance: 500 })).toEqual([
      { key: 'b', from: 10, to: 0, at: 0 },
      { key: 'a', from: 0, to: 10, at: 10 },
    ]);
  });

  it('slides a long move up only the room in view, coming in from below its place', () => {
    // c rose 2000px: it slides the last 500 of them, ending at its place.
    expect(slides({ after: stack(['c']), startBefore, maxDistance: 500 })).toEqual([
      { key: 'c', from: 500, to: 0, at: 0 },
    ]);
  });

  it('slides a long move down only the room in view, then sits at its place', () => {
    const after: Slot[] = [{ key: 'a', start: 3000, size: 10 }];
    expect(slides({ after, startBefore, maxDistance: 500 })).toEqual([
      { key: 'a', from: 0, to: 500, at: 3000 },
    ]);
  });
});

describe('slideRoom', () => {
  // A folder `f` at 10 closes over 100 rows; the view ends at 200.
  const before = stack(['f', ...Array.from({ length: 100 }, (_, i) => `c${i}`), 'g']);
  const gone = goneRows(before, (k) => k === 'f' || k === 'g');

  it('is the room the run’s edge travels in view, so the rows below keep pace', () => {
    expect(slideRoom(gone, 200, 999)).toBe(190);
    // The row below then comes in from the view’s bottom, as the edge does.
    expect(
      slides({
        after: stack(['f', 'g']),
        startBefore: (k) => (k === 'g' ? 1010 : 0),
        maxDistance: 190,
      }),
    ).toEqual([{ key: 'g', from: 200, to: 10, at: 10 }]);
  });

  it('is the whole run when it shows in full', () => {
    expect(
      slideRoom(
        goneRows(stack(['f', 'a', 'b', 'g']), (k) => k === 'f' || k === 'g'),
        200,
        999,
      ),
    ).toBe(20);
  });

  it('falls back with no run (a reorder)', () => {
    expect(slideRoom([], 200, 999)).toBe(999);
  });
});

describe('sameKeys', () => {
  it('compares in order', () => {
    expect(sameKeys(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameKeys(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameKeys(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('keyframes', () => {
  it('holds a new row hidden until its window, then shown to the end', () => {
    const frames = enterKeyframes(20, [0.25, 0.75]);
    expect(frames.map((f) => [f.offset, f.opacity, f.clipPath])).toEqual([
      [0, 0, 'inset(0 0 20px 0)'],
      [0.25, 0, 'inset(0 0 20px 0)'],
      [0.75, 1, 'inset(0 0 0px 0)'],
      [1, 1, 'inset(0 0 0px 0)'],
    ]);
  });

  it('holds a removed row shown until its window, then hidden to the end', () => {
    const frames = exitKeyframes(20, [0.5, 1]);
    expect(frames.map((f) => [f.offset, f.opacity])).toEqual([
      [0, 1],
      [0.5, 1],
      [1, 0],
      [1, 0],
    ]);
  });
});
