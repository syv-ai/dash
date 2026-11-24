import { describe, it, expect } from 'vitest';
import { defaultKind, draftSubmitLabel, isInlineThread } from '../prViewPolicy';
import type { PrReviewThread } from '../../../../../shared/types';

describe('PR view policy', () => {
  it("starts a comment on someone else's PR, else a note", () => {
    expect(defaultKind({ isPrView: true, viewerIsAuthor: false })).toBe('comment');
    expect(defaultKind({ isPrView: true, viewerIsAuthor: true })).toBe('note');
    expect(defaultKind({ isPrView: false, viewerIsAuthor: false })).toBe('note');
    expect(defaultKind({ isPrView: false, viewerIsAuthor: true })).toBe('note');
  });

  it.each([
    [true, 'comment', undefined, 'Add comment'],
    [true, 'note', undefined, 'Add note'],
    [false, 'note', undefined, undefined],
    [true, 'comment', 'note', 'Save note'],
    [true, 'note', 'comment', 'Save comment'],
    [false, 'note', 'note', 'Save'],
  ] as const)('PR view %s, new %s, editing %s → %s', (isPr, newKind, editing, label) => {
    expect(draftSubmitLabel(isPr, newKind, editing)).toBe(label);
  });

  it("draws a thread only on a line of the PR's side", () => {
    const t = (line: number | null, side: 'LEFT' | 'RIGHT') =>
      ({ line, side }) as unknown as PrReviewThread;
    expect(isInlineThread(t(4, 'RIGHT'))).toBe(true);
    expect(isInlineThread(t(4, 'LEFT'))).toBe(false);
    expect(isInlineThread(t(null, 'RIGHT'))).toBe(false);
  });
});
