import { describe, it, expect } from 'vitest';
import { draftSubmitLabel, isInlineThread, newCommentKind } from '../prViewPolicy';
import type { PrReviewThread } from '../../../../../shared/types';

describe('PR view policy', () => {
  it('writes a PR comment only while reviewing a PR', () => {
    expect(newCommentKind(true, true)).toBe('comment');
    expect(newCommentKind(true, false)).toBe('note');
    expect(newCommentKind(false, true)).toBe('note');
    expect(newCommentKind(false, false)).toBe('note');
  });

  it.each([
    [true, true, undefined, 'Add comment'],
    [true, false, undefined, 'Add note'],
    [false, false, undefined, undefined],
    [true, true, 'note', 'Save note'],
    [true, false, 'comment', 'Save comment'],
    [false, false, 'note', 'Save'],
  ] as const)('PR view %s, in review %s, editing %s → %s', (isPr, inReview, editing, label) => {
    expect(draftSubmitLabel(isPr, inReview, editing)).toBe(label);
  });

  it("draws a thread only on a line of the PR's side", () => {
    const t = (line: number | null, side: 'LEFT' | 'RIGHT') =>
      ({ line, side }) as unknown as PrReviewThread;
    expect(isInlineThread(t(4, 'RIGHT'))).toBe(true);
    expect(isInlineThread(t(4, 'LEFT'))).toBe(false);
    expect(isInlineThread(t(null, 'RIGHT'))).toBe(false);
  });
});
