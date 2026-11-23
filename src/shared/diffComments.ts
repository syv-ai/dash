import { isPrScope } from './prScope';
import type { DiffComment, DiffCommentKind } from './types';

/*
 * What a note, a comment and a reply are, and which of them each action may
 * touch. Main and renderer both ask here, so they can't disagree.
 *
 * - A note is local, for the agent working on the task; it never reaches a PR.
 * - A comment is a PR review comment, a draft until Submit posts it. Only a PR
 *   scope holds comments. Sending one to the agent doesn't take it off the PR.
 * - A reply is a comment that answers a PR thread instead of sitting on lines.
 */

type Kinded = { kind?: DiffCommentKind };
type Scoped = { viewScope: string };

/** A draft reply to a PR thread, rather than a comment on lines. */
export const isReplyDraft = (c: Pick<DiffComment, 'replyTo'>): boolean => c.replyTo != null;

/** A PR review comment (a draft until Submit), rather than a note for the agent. */
export const isPrComment = (c: Kinded): boolean => c.kind === 'comment';

/** What a draft written in `viewScope` is: only a PR scope holds comments. */
export const kindFor = (viewScope: string, kind: DiffCommentKind | undefined): DiffCommentKind =>
  kind === 'comment' && isPrScope(viewScope) ? 'comment' : 'note';

/** A note still to send, or a PR comment still to submit. */
export const needsAttention = (c: Kinded & { sent?: boolean }): boolean =>
  !c.sent || isPrComment(c);

/** Clear sent (in `scope`, or everywhere): sent notes go; comments stay for Submit. */
export const clearedBySent = (c: Kinded & Scoped & { sent?: boolean }, scope?: string): boolean =>
  !!c.sent && !isPrComment(c) && (scope === undefined || c.viewScope === scope);

/** Clear notes (before a submit): every note of the scope, sent or not. */
export const clearedByClearNotes = (c: Kinded & Scoped, scope: string): boolean =>
  !isPrComment(c) && c.viewScope === scope;

/** Submit posts its PR's comments (on lines, and replies), never its notes. */
export const isSubmittable = (c: Kinded & Scoped): boolean =>
  isPrScope(c.viewScope) && isPrComment(c);

/** A note on a PR that can become a PR comment. */
export const canPromote = (c: Kinded & Scoped): boolean =>
  isPrScope(c.viewScope) && !isPrComment(c);

/** A PR's note or comment: what an agent may read and change through the control API. */
export const isPrDraft = (c: Scoped): boolean => isPrScope(c.viewScope);

/** Pruned when its file is gone from the checkout. A PR's drafts are kept: its
 *  files needn't exist there. */
export const isPrunable = (
  c: Scoped & { filePath: string },
  existingFilePaths: ReadonlySet<string>,
): boolean => !isPrScope(c.viewScope) && !existingFilePaths.has(c.filePath);

/**
 * Where a PR line draft stands against the PR's head now: written on that
 * head ('current'), on an older one, so its lines may sit on other code now
 * ('moved'), or not known ('unknown': written before Dash recorded it, or the
 * head couldn't be read). Replies sit on their thread, not on lines.
 */
export type AnchorStatus = 'current' | 'moved' | 'unknown';

export const anchorStatus = (
  c: Pick<DiffComment, 'commit'>,
  head: string | null | undefined,
): AnchorStatus => (!c.commit || !head ? 'unknown' : c.commit === head ? 'current' : 'moved');

/** A line draft written on an older head of its PR: Submit holds it back. */
export const isMoved = (
  c: Pick<DiffComment, 'commit' | 'replyTo'>,
  head: string | null | undefined,
): boolean => !isReplyDraft(c) && anchorStatus(c, head) === 'moved';
