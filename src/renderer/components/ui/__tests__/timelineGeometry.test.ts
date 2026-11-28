import { describe, expect, it } from 'vitest';
import {
  areaPath,
  gradientStops,
  linePath,
  nearestIndex,
  plotMax,
  runs,
  xAt,
  yAt,
  type TimelineFrame,
} from '../timelineGeometry';

const F: TimelineFrame = { width: 104, height: 54, from: 0, to: 100, max: 10, inset: 2 };
const pts = (...xs: [number, number][]) => xs.map(([at, value]) => ({ at, value }));

describe('scales', () => {
  it('maps time across the inset width and clamps outside the span', () => {
    expect(xAt(F, 0)).toBe(2);
    expect(xAt(F, 50)).toBe(52);
    expect(xAt(F, 100)).toBe(102);
    expect(xAt(F, 200)).toBe(102);
  });

  it('maps value up from the bottom, 0 at the baseline', () => {
    expect(yAt(F, 0)).toBe(52);
    expect(yAt(F, 10)).toBe(2);
    expect(yAt(F, 5)).toBe(27);
    expect(yAt(F, -1)).toBe(52);
  });

  it('draws a one-instant span at the right edge', () => {
    expect(xAt({ ...F, to: 0 }, 0)).toBe(102);
  });
});

describe('plotMax', () => {
  it('leaves headroom over the higher of the data and the threshold', () => {
    expect(plotMax(pts([0, 4]), 6)).toBeCloseTo(7.2);
    expect(plotMax(pts([0, 9]), 6)).toBeCloseTo(10.8);
    expect(plotMax([], undefined)).toBe(1);
  });
});

describe('runs and paths', () => {
  it('breaks the line where samples are further apart than the gap', () => {
    const rs = runs(pts([0, 1], [10, 2], [60, 3], [70, 4]), 30);
    expect(rs.map((r) => r.map((p) => p.at))).toEqual([
      [0, 10],
      [60, 70],
    ]);
    expect(linePath(F, rs)).toBe('M2 47L12 42M62 37L72 32');
  });

  it('closes each run of two or more points to the baseline', () => {
    const rs = runs(pts([0, 1], [10, 2], [60, 3]), 30);
    expect(areaPath(F, rs)).toBe('M2 52L2 47L12 42L12 52Z');
  });
});

describe('gradientStops', () => {
  it('runs top to bottom, colouring each height by its value', () => {
    const stops = gradientStops(F, (v) => `c${v}`, 3);
    expect(stops).toEqual([
      { offset: 0, color: 'c10' },
      { offset: 0.5, color: 'c5' },
      { offset: 1, color: 'c0' },
    ]);
  });

  it('places an exact value, and ignores one off the plot', () => {
    const stops = gradientStops(F, (v) => `c${v}`, 2, [6, 99]);
    expect(stops.map((s) => s.color)).toEqual(['c10', 'c6', 'c0']);
    expect(stops[1]?.offset).toBeCloseTo(0.4);
  });
});

describe('nearestIndex', () => {
  const p = pts([0, 1], [10, 1], [30, 1]);
  it('finds the point nearest in time, the earlier on a tie', () => {
    expect(nearestIndex(p, -5)).toBe(0);
    expect(nearestIndex(p, 4)).toBe(0);
    expect(nearestIndex(p, 5)).toBe(0);
    expect(nearestIndex(p, 6)).toBe(1);
    expect(nearestIndex(p, 21)).toBe(2);
    expect(nearestIndex(p, 99)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});
