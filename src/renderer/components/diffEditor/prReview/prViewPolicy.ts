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

/** What the composer writes: in a PR view the person's last pick there this
 *  session, else the default; outside a PR view always a note (comments need
 *  a pull request). */
export function composerKind({
  isPrView,
  viewerIsAuthor,
  picked,
}: {
  isPrView: boolean;
  viewerIsAuthor: boolean;
  picked: DiffCommentKind | undefined;
}): DiffCommentKind {
  if (!isPrView) return 'note';
  return picked ?? defaultKind({ isPrView, viewerIsAuthor });
}

/** The other kind: what ⌘⇧N flips the composer to. */
export const otherKind = (k: DiffCommentKind): DiffCommentKind =>
  k === 'note' ? 'comment' : 'note';

/** The comment box's submit label. An edit keeps the kind it has; a new one
 *  says which it will be. */
export function draftSubmitLabel(
  isPrView: boolean,
  newKind: DiffCommentKind,
  editingKind: DiffCommentKind | undefined,
): string {
  if (editingKind) return isPrView ? `Save ${editingKind}` : 'Save';
  return newKind === 'comment' ? 'Add comment' : 'Add note';
}
