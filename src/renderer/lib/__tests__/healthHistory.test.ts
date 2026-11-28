import { describe, expect, it } from 'vitest';
import { appendPoint } from '../healthHistory';

const pt = (at: number) => ({ at, totalBytes: at });

describe('appendPoint', () => {
  it('adds a newer point at the end', () => {
    expect(appendPoint([pt(1), pt(2)], pt(3), 100).map((p) => p.at)).toEqual([1, 2, 3]);
  });

  it('ignores a point no newer than the last', () => {
    const h = [pt(1), pt(5)];
    expect(appendPoint(h, pt(5), 100)).toBe(h);
    expect(appendPoint(h, pt(3), 100)).toBe(h);
  });

  it('drops what falls out of the window behind the new point', () => {
    expect(appendPoint([pt(0), pt(40), pt(90)], pt(120), 100).map((p) => p.at)).toEqual([
      40, 90, 120,
    ]);
    expect(appendPoint([pt(0)], pt(500), 100).map((p) => p.at)).toEqual([500]);
  });
});
