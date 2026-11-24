import type { PrProvider, PrVerdict } from '../../../shared/types';
import { plural, providerName } from './labels';

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

/** Something would reach the PR: a comment or reply, a summary, or a verdict
 *  beyond Comment. */
export const canPost = ({ comments, summary, verdict }: ReviewToPost): boolean =>
  comments > 0 || summary.trim() !== '' || verdict !== 'comment';

/** "Post review to GitHub (5 comments · Request changes)"; the count only when
 *  there are comments. */
export function postLabel(provider: PrProvider, { comments, verdict }: ReviewToPost): string {
  const parts = [comments > 0 && plural(comments, 'comment'), VERDICT_LABELS[verdict]].filter(
    Boolean,
  );
  return `Post review to ${providerName(provider)} (${parts.join(' · ')})`;
}
