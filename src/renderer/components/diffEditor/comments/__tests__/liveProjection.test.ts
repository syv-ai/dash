import { describe, it, expect } from 'vitest';
import { projectRanges, rangesEqual, type RangeReader } from '../liveProjection';
import type { LiveComment } from '../types';

const live = (id: string, startLine: number, endLine: number): LiveComment => ({
  id,
  taskId: 't1',
  filePath: 'a.ts',
  startLine,
  endLine,
  text: 't',
  sent: false,
  createdAt: '',
  updatedAt: '',
  decorationId: `dec-${id}`,
});

describe('projectRanges', () => {
  it('overwrites start/end from the reader for each comment', () => {
    const reader: RangeReader = (decId) =>
      decId === 'dec-a' ? { startLine: 10, endLine: 12 } : null;
    const out = projectRanges([live('a', 1, 1), live('b', 5, 5)], reader);
    expect(out.find((c) => c.id === 'a')).toMatchObject({ startLine: 10, endLine: 12 });
    // 'b' has no live range → keep its prior range.
    expect(out.find((c) => c.id === 'b')).toMatchObject({ startLine: 5, endLine: 5 });
  });
});

describe('rangesEqual', () => {
  it('true when every id has identical start/end', () => {
    expect(rangesEqual([live('a', 1, 2)], [live('a', 1, 2)])).toBe(true);
  });
  it('false when a range shifts', () => {
    expect(rangesEqual([live('a', 1, 2)], [live('a', 1, 3)])).toBe(false);
  });
  it('false when membership differs', () => {
    expect(rangesEqual([live('a', 1, 2)], [live('a', 1, 2), live('b', 4, 4)])).toBe(false);
  });
});
