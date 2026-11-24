import { useEffect } from 'react';
import type { TaskReviewTarget } from '../../../shared/types';
import { useGit } from '../../stores/gitStore';
import { usePrReviews } from '../../stores/prReviewStore';

/**
 * The PR the task reviews and why (D3), as main tells it: the PR picked for
 * it, else its own open PR; null for none, undefined until known. Asked again
 * whenever the task's PRs change (one opens, merges or closes).
 */
export function useReviewTarget(taskId: string): TaskReviewTarget | null | undefined {
  const target = usePrReviews((s) => s.targets[taskId]);
  const prs = useGit((s) => s.prByTask[taskId]?.map((p) => `${p.number}:${p.state}`).join());
  useEffect(() => {
    void usePrReviews.getState().loadTarget(taskId);
  }, [taskId, prs]);
  return target;
}
