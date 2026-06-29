import { describe, it, expect } from 'vitest';
import {
  isFullModelReplace,
  isWholeBlockDeleted,
  commentsDeletedByEdit,
  projectRanges,
  rangesEqual,
  type EditChange,
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

describe('isWholeBlockDeleted', () => {
  // A whole-line comment spanning lines [start, end]; the deletion is a pure
  // removal (text: '') of the range (sl,sc)-(el, *).
  const del = (startLine: number, startColumn: number, endLine: number): EditChange => ({
    startLine,
    startColumn,
    endLine,
    text: '',
  });

  it('removes a mid-file block deleted from its first col through past its last line', () => {
    // comment 5-8, delete (5,1)-(9,1)
    expect(isWholeBlockDeleted(5, 8, del(5, 1, 9))).toBe(true);
  });

  it('removes a single-line comment whose line is deleted', () => {
    expect(isWholeBlockDeleted(5, 5, del(5, 1, 6))).toBe(true);
  });

  it('removes when the deletion starts on an earlier line', () => {
    // delete the trailing newline of line 4 through line 9 → lines 5-8 gone
    expect(isWholeBlockDeleted(5, 8, del(4, 20, 9))).toBe(true);
  });

  it('keeps the comment when replacement text is non-empty (edit to one line)', () => {
    expect(isWholeBlockDeleted(5, 8, { startLine: 5, startColumn: 1, endLine: 9, text: 'x' })).toBe(
      false,
    );
  });

  it('keeps the comment when its first line survives (deletion starts mid-line)', () => {
    expect(isWholeBlockDeleted(5, 8, del(5, 4, 9))).toBe(false);
  });

  it('keeps the comment when its last line survives (deletion ends on it)', () => {
    // delete (5,1)-(8,1) removes lines 5-7, line 8 remains as a valid anchor
    expect(isWholeBlockDeleted(5, 8, del(5, 1, 8))).toBe(false);
  });

  it('keeps the comment when only a leading subset of lines is deleted', () => {
    // delete (6,1)-(9,1): line 5 survives
    expect(isWholeBlockDeleted(5, 8, del(6, 1, 9))).toBe(false);
  });
});

describe('commentsDeletedByEdit', () => {
  it('collects ids whose whole block any change deletes', () => {
    const comments = [
      { id: 'a', startLine: 5, endLine: 8 },
      { id: 'b', startLine: 20, endLine: 20 },
    ];
    const changes: EditChange[] = [{ startLine: 5, startColumn: 1, endLine: 9, text: '' }];
    expect(commentsDeletedByEdit(comments, changes)).toEqual(['a']);
  });

  it('returns empty when no block is fully deleted', () => {
    const comments = [{ id: 'a', startLine: 5, endLine: 8 }];
    const changes: EditChange[] = [{ startLine: 6, startColumn: 1, endLine: 7, text: '' }];
    expect(commentsDeletedByEdit(comments, changes)).toEqual([]);
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
