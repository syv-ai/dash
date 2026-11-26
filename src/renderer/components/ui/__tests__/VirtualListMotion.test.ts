import { describe, it, expect } from 'vitest';
import {
  enterKeyframes,
  exitKeyframes,
  goneRows,
  hideWindow,
  newRows,
  revealWindow,
  sameKeys,
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
      { key: 'b', from: 10, to: 0 },
      { key: 'a', from: 0, to: 10 },
    ]);
  });

  it('lets a move longer than maxDistance jump', () => {
    expect(slides({ after: stack(['c']), startBefore, maxDistance: 500 })).toEqual([]);
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
