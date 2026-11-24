import type { DiffCommentKind, PrReviewThread } from '../../../../shared/types';

/** True when a thread can be drawn on the PR side of its file. */
export function isInlineThread(t: PrReviewThread): boolean {
  return t.line !== null && t.side === 'RIGHT';
}

/** What a new note or comment starts as: a comment on someone else's PR (it's
 *  for its author), a note on your own PR or outside a PR (it's for the agent). */
export function defaultKind({
  isPrView,
  viewerIsAuthor,
}: {
  isPrView: boolean;
  viewerIsAuthor: boolean;
}): DiffCommentKind {
  return isPrView && !viewerIsAuthor ? 'comment' : 'note';
}

/** The comment box's submit label. An edit keeps the kind it has; a new one in
 *  a PR view says which it will be. Undefined: the box's own default. */
export function draftSubmitLabel(
  isPrView: boolean,
  newKind: DiffCommentKind,
  editingKind: DiffCommentKind | undefined,
): string | undefined {
  if (editingKind) return isPrView ? `Save ${editingKind}` : 'Save';
  if (!isPrView) return undefined;
  return newKind === 'comment' ? 'Add comment' : 'Add note';
}
