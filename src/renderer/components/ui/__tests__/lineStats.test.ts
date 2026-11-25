import { describe, expect, it } from 'vitest';
import { lineStatsColumns } from '../LineStats';

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
