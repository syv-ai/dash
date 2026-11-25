import { useMemo } from 'react';
import { prScope } from '../../../shared/prScope';
import type { PrReview } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { reviewComments, reviewTally } from './outline';

/** Review mode's comment counts for the task (`reviewTally`): the view
 *  switch's Comments tab and the Comments | Notes switch show the same ones.
 *  Null until the PR's review has loaded. */
export function useReviewTally(
  taskId: string,
  review: PrReview | null,
): { comments: number; notes: number } | null {
  const byFile = useCommentsStore((s) => (s.taskId === taskId && !s.disabled ? s.byFile : null));
  return useMemo(() => {
    if (!review) return null;
    const own = byFile ?? {};
    const scope = prScope(review.provider, review.number);
    return reviewTally(review.threads, reviewComments(own, scope), own);
  }, [review, byFile]);
}
