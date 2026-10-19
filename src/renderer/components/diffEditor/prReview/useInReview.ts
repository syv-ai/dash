import { useCommentsStore } from '../../../stores/commentsStore';
import { reviewKey, usePrReviews } from '../../../stores/prReviewStore';
import { parsePrScope } from '../../../../shared/prScope';

/** Whether the loaded task is reviewing the PR of `scope` (a PR view's comment
 *  scope): then what's written there is a PR comment, else a note. */
export function useInReview(scope: string | null): boolean {
  const taskId = useCommentsStore((s) => s.taskId);
  return usePrReviews((s) => {
    const pr = scope ? parsePrScope(scope) : null;
    return !!pr && !!taskId && s.inReview[reviewKey(taskId, pr.provider, pr.number)] === true;
  });
}
