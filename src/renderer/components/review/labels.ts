import type { PrCheck, PrProvider, PrReview, PrReviewer, PrState } from '../../../shared/types';

/** The forge's name, as people say it. */
export const providerName = (p: PrProvider): string => (p === 'ado' ? 'Azure DevOps' : 'GitHub');

/** Words for a PR's state, its reviewers' states and its checks' states:
 *  the Review header's and the PR overview's. */
export const STATE_LABELS: Record<PrState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

export const REVIEWER_LABELS: Record<PrReviewer['state'], string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
  pending: 'pending',
  approved_with_suggestions: 'approved with suggestions',
  waiting: 'waiting for author',
  rejected: 'rejected',
};

export const CHECK_LABELS: Record<PrCheck['state'], string> = {
  passing: 'Passing',
  failing: 'Failing',
  pending: 'Running',
  skipped: 'Skipped',
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "4 commits · 2 behind base"; the behind count only when it is known. */
export const distanceLine = (review: Pick<PrReview, 'commits' | 'behindBase'>): string =>
  [
    plural(review.commits, 'commit'),
    review.behindBase !== null && `${review.behindBase} behind base`,
  ]
    .filter(Boolean)
    .join(' · ');
