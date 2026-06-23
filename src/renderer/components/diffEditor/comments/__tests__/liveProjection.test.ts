import { describe, it, expect } from 'vitest';
import {
  isFullModelReplace,
  projectRanges,
  rangesEqual,
  type RangeReader,
} from '../liveProjection';
import type { LiveComment } from '../types';

const live = (id: string, startLine: number, endLine: number): LiveComment => ({
  id,
  taskId: 't1',
  filePath: 'a.ts',
  startLine,
  endLine,
  text: 't',
  sent: false,
  viewScope: 'live',
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

describe('isFullModelReplace', () => {
  const newDoc = 'line1\nline2\nline3';

  it('true for a flush (setValue in commit view)', () => {
    expect(isFullModelReplace({ isFlush: true, changes: [] }, newDoc)).toBe(true);
  });

  it('true for the lib full-range edit: one change at offset 0 whose text is the whole new doc', () => {
    expect(
      isFullModelReplace({ isFlush: false, changes: [{ rangeOffset: 0, text: newDoc }] }, newDoc),
    ).toBe(true);
  });

  it('false for an incremental edit (typing a char mid-document)', () => {
    expect(
      isFullModelReplace({ isFlush: false, changes: [{ rangeOffset: 12, text: 'x' }] }, newDoc),
    ).toBe(false);
  });

  it('false for an edit at offset 0 that only replaces part of the doc', () => {
    expect(
      isFullModelReplace({ isFlush: false, changes: [{ rangeOffset: 0, text: 'line1' }] }, newDoc),
    ).toBe(false);
  });

  it('false for a multi-change edit (e.g. multi-cursor)', () => {
    expect(
      isFullModelReplace(
        {
          isFlush: false,
          changes: [
            { rangeOffset: 0, text: 'a' },
            { rangeOffset: 5, text: 'b' },
          ],
        },
        newDoc,
      ),
    ).toBe(false);
  });
});
