import { describe, expect, it } from 'vitest';
import { lineStatsColumns, lineStatsWidth } from '../LineStats';

describe('lineStatsColumns', () => {
  it('sizes each side to its widest count, sign included', () => {
    expect(
      lineStatsColumns([
        { additions: 7, deletions: 1200 },
        { additions: 128, deletions: 3 },
      ]),
    ).toEqual({ add: 4, del: 5 });
  });

  it('gives a side no row has (zero or unknown) no width', () => {
    expect(
      lineStatsColumns([
        { additions: 5, deletions: 0 },
        { additions: null, deletions: null },
      ]),
    ).toEqual({ add: 2, del: 0 });
    expect(lineStatsColumns([])).toEqual({ add: 0, del: 0 });
  });
});

describe('lineStatsWidth', () => {
  it("fits the widest row's pair, signs and the space between included", () => {
    expect(
      lineStatsWidth([
        { additions: 7, deletions: 1200 },
        { additions: 128, deletions: 3 },
      ]),
    ).toEqual(8);
  });

  it('adds no space for a one-sided row, and no width for none', () => {
    expect(lineStatsWidth([{ additions: 128, deletions: 0 }])).toEqual(4);
    expect(lineStatsWidth([{ additions: null, deletions: null }])).toEqual(0);
    expect(lineStatsWidth([])).toEqual(0);
  });
});
