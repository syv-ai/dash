import type { DiffCommentKind, PrReviewThread } from '../../../../shared/types';

/** True when a thread can be drawn on the PR side of its file. */
export function isInlineThread(t: PrReviewThread): boolean {
  return t.line !== null && t.side === 'RIGHT';
}

/** What a new note or comment written in the view is: a PR comment only while
 *  reviewing a PR, else a note. */
export function newCommentKind(isPrView: boolean, inReview: boolean): DiffCommentKind {
  return isPrView && inReview ? 'comment' : 'note';
}

/** The comment box's submit label. An edit keeps the kind it has; a new one in
 *  a PR view is a note until Review. Undefined: the box's own default. */
export function draftSubmitLabel(
  isPrView: boolean,
  inReview: boolean,
  editingKind: DiffCommentKind | undefined,
): string | undefined {
  if (editingKind) return isPrView ? `Save ${editingKind}` : 'Save';
  if (!isPrView) return undefined;
  return inReview ? 'Add comment' : 'Add note';
}
