import { isMoved, isPrComment } from '../../../shared/diffComments';
import { formatTimeAgo } from '../../../shared/relativeTime';
import type {
  DiffComment,
  PrProvider,
  PrReviewThread,
  PrVerdict,
  PrViewerReview,
} from '../../../shared/types';
import { plural, providerName } from './labels';
import { threadGroups, type ThreadItem } from './outline';

/** The Finish-review sheet's rules: what a verdict is called, whether there
 *  is anything to post, and what the post button says. */

export const VERDICT_LABELS: Record<PrVerdict, string> = {
  comment: 'Comment',
  approve: 'Approve',
  request_changes: 'Request changes',
  approve_with_suggestions: 'Approve with suggestions',
  wait_for_author: 'Wait for author',
  reject: 'Reject',
};

/** The verdict to post: the one picked when the PR offers it, else Comment. */
export const offeredVerdict = (verdicts: readonly PrVerdict[], picked: PrVerdict): PrVerdict =>
  verdicts.includes(picked) ? picked : 'comment';

export interface ReviewToPost {
  /** Comments and replies (notes never post). */
  comments: number;
  summary: string;
  verdict: PrVerdict;
}

/** The comments and replies that post, and the line comments held back:
 *  written on an older head than `head`, the PR's as loaded. */
export function splitHeldBack<C extends Pick<DiffComment, 'commit' | 'replyTo'>>(
  drafts: readonly C[],
  head: string,
): { posting: C[]; heldBack: C[] } {
  const heldBack = drafts.filter((c) => isMoved(c, head));
  return { posting: drafts.filter((c) => !isMoved(c, head)), heldBack };
}

/** Something would reach the PR: a comment or reply, a summary, or a verdict
 *  beyond Comment. */
export const canPost = ({ comments, summary, verdict }: ReviewToPost): boolean =>
  comments > 0 || summary.trim() !== '' || verdict !== 'comment';

/**
 * Whether review mode's footer offers Finish review…: always on someone else's PR; on
 * the own PR only with something a review would post beyond the replies,
 * which post one by one (a line comment, or a summary).
 */
export const finishOffered = ({
  own,
  comments,
  summary,
}: {
  own: boolean;
  /** The person's comments and replies for the PR. */
  comments: readonly Pick<DiffComment, 'replyTo'>[];
  summary: string;
}): boolean => !own || summary.trim() !== '' || comments.some((c) => c.replyTo == null);

/** "Post review to GitHub · 5 comments · Request changes": the count only when
 *  there are comments, the verdict only when it says more than Comment (the
 *  button already says it posts a review). */
export function postLabel(provider: PrProvider, { comments, verdict }: ReviewToPost): string {
  return [
    `Post review to ${providerName(provider)}`,
    comments > 0 && plural(comments, 'comment'),
    verdict !== 'comment' && VERDICT_LABELS[verdict],
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The notes on the PR whose draft scope is `scope` not yet sent to the agent:
 *  what "n notes stay local" counts. */
export const unsentNoteCount = (
  byFile: Readonly<Record<string, readonly DiffComment[]>>,
  scope: string,
): number =>
  Object.values(byFile)
    .flat()
    .filter((c) => c.viewScope === scope && !isPrComment(c) && !c.sent).length;

/** What posts, as the Threads tab lists it (`threadGroups`): each thread
 *  the person drafted a reply in and each draft thread, open threads first,
 *  by file and line. Threads without a draft are left out. */
export function postingItems(
  threads: readonly PrReviewThread[],
  drafts: readonly DiffComment[],
): ThreadItem[] {
  const { unresolved, resolved } = threadGroups(threads, drafts);
  return [...unresolved, ...resolved].filter((i) => i.kind === 'draft' || i.replies.length > 0);
}

/** What the person's own review said, as Finish review names it. */
export const OWN_REVIEW_LABELS: Record<PrViewerReview['state'], string> = {
  approved: 'Approved',
  approved_with_suggestions: 'Approved with suggestions',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  waiting: 'Waiting for author',
  rejected: 'Rejected',
};

/** "Approved 3 days ago · new commits since"; "None" before a first review.
 *  `now` in ms. */
export function ownReviewLine(review: PrViewerReview | null, now: number): string {
  if (!review) return 'None';
  const at = Date.parse(review.at);
  const when = at > 0 ? formatTimeAgo(at / 1000, now / 1000) : '';
  return [
    [OWN_REVIEW_LABELS[review.state], when].filter(Boolean).join(' '),
    review.stale && 'new commits since',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "1 new thread, 2 replies": the person's drafts that post (a draft on
 *  lines starts a thread; a draft reply adds to one); "None" without. */
export function draftsLine(drafts: readonly Pick<DiffComment, 'replyTo'>[]): string {
  const replies = drafts.filter((c) => c.replyTo).length;
  const threads = drafts.length - replies;
  return (
    [
      threads > 0 && plural(threads, 'new thread'),
      replies > 0 && (replies === 1 ? '1 reply' : `${replies} replies`),
    ]
      .filter(Boolean)
      .join(', ') || 'None'
  );
}

/** "2 open, 9 resolved": the PR's threads; "None" without. */
export function threadsLineShort(threads: readonly Pick<PrReviewThread, 'resolved'>[]): string {
  const resolved = threads.filter((t) => t.resolved).length;
  const open = threads.length - resolved;
  return (
    [open > 0 && `${open} open`, resolved > 0 && `${resolved} resolved`]
      .filter(Boolean)
      .join(', ') || 'None'
  );
}

/** The drafts a review would post: the comments and replies, and the
 *  summary when it has words. */
export const draftCount = (drafts: number, summary: string): number =>
  drafts + (summary.trim() ? 1 : 0);

/** "2 drafts · 1 note": a PR's review still in hand, as Finish review counts
 *  its drafts, and its notes not yet sent to the agent; '' with neither. */
export function pendingReviewLine({
  drafts,
  summary,
  notes,
}: {
  drafts: number;
  summary: string;
  notes: number;
}): string {
  const count = draftCount(drafts, summary);
  return [count > 0 && plural(count, 'draft'), notes > 0 && plural(notes, 'note')]
    .filter(Boolean)
    .join(' · ');
}

/** What Finish review's button says: its label, and what the person's last
 *  review was (its tooltip; null before one). */
export interface FinishButton {
  label: string;
  title: string | null;
}

/**
 * The button's words, "where it stands · what it does": drafts waiting lead
 * ("2 drafts · Finish review…"); without any, the person's last review
 * ("Approved · Review again…"), or a nudge once commits have landed since it
 * ("Re-review new commits…"); before any review, "Review…". The summary
 * counts as a draft. The count is words, not a badge: a badge's tones don't
 * read on the primary button.
 */
export function finishButton(
  {
    drafts,
    summary,
    own,
  }: {
    /** The person's comments and replies for the PR. */
    drafts: number;
    summary: string;
    own: PrViewerReview | null;
  },
  now: number,
): FinishButton {
  const count = draftCount(drafts, summary);
  const title = own ? `Your review: ${ownReviewLine(own, now)}` : null;
  if (count > 0) return { label: `${plural(count, 'draft')} · Finish review…`, title };
  if (own?.stale) return { label: 'Re-review new commits…', title };
  if (own) return { label: `${OWN_REVIEW_LABELS[own.state]} · Review again…`, title };
  return { label: 'Review…', title: null };
}
