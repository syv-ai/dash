import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PrRef } from '../../../shared/types';
import { useGit } from '../../stores/gitStore';
import { usePrReviews } from '../../stores/prReviewStore';
import { effectiveTarget } from './outline';

export interface ReviewTarget {
  /** The PR the task reviews (see `effectiveTarget`); undefined while loading. */
  target: PrRef | null | undefined;
  /** The PR picked for the task, which "Stop reviewing" clears; undefined while loading. */
  stored: PrRef | null | undefined;
  /** The task's own open PR; undefined until its PRs are known. */
  own: PrRef | null | undefined;
}

/** The task's review target (D3): the PR picked for it, else its own open PR. */
export function useReviewTarget(taskId: string): ReviewTarget {
  const stored = usePrReviews((s) => s.targets[taskId]);
  const own = useGit(
    useShallow((s): PrRef | null | undefined => {
      const prs = s.prByTask[taskId];
      if (!prs) return undefined;
      const pr = prs[0];
      return pr && pr.state === 'open' ? { provider: pr.provider, number: pr.number } : null;
    }),
  );
  useEffect(() => {
    if (usePrReviews.getState().targets[taskId] === undefined)
      void usePrReviews.getState().loadTarget(taskId);
  }, [taskId]);
  return { target: effectiveTarget(stored, own), stored, own };
}
