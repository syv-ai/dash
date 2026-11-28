import { describe, expect, it } from 'vitest';
import { HealthHistory } from '../healthHistory';

const pt = (at: number) => ({ at, totalBytes: at * 10 });

describe('HealthHistory', () => {
  it('reads back oldest first', () => {
    const h = new HealthHistory(5, 1_000);
    [1, 2, 3].forEach((at) => h.push(pt(at)));
    expect(h.points().map((p) => p.at)).toEqual([1, 2, 3]);
  });

  it('keeps only the newest `capacity` points once it wraps', () => {
    const h = new HealthHistory(3, 1_000);
    [1, 2, 3, 4, 5, 6, 7].forEach((at) => h.push(pt(at)));
    expect(h.points().map((p) => p.at)).toEqual([5, 6, 7]);
  });

  it('drops points older than maxAgeMs before the newest, or before now', () => {
    const h = new HealthHistory(10, 100);
    [0, 50, 120, 200].forEach((at) => h.push(pt(at)));
    expect(h.points().map((p) => p.at)).toEqual([120, 200]);
    expect(h.points(260).map((p) => p.at)).toEqual([200]);
    expect(h.points(1_000)).toEqual([]);
  });

  it('is empty before the first point', () => {
    expect(new HealthHistory(2, 100).points()).toEqual([]);
  });

  it('refuses a capacity below one', () => {
    expect(() => new HealthHistory(0, 100)).toThrow();
  });
});
