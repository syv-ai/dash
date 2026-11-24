import { useCallback, useEffect, useState } from 'react';
import type { PrRef, PrReview } from '../../../shared/types';
import { prKey, reviewKey, usePrReviews } from '../../stores/prReviewStore';

/** How often a visible Review view refetches its PR (D8). */
export const REVIEW_RELOAD_MS = 60_000;

const NO_MARKS: Record<string, string> = {};

export interface ReviewData {
  /** The PR's review as last fetched; null until the first fetch lands. */
  review: PrReview | null;
  /** The task's viewed marks on it: path → blob. */
  marks: Record<string, string>;
  /** Why the last fetch failed; null after a good one. */
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * The target PR's review and the task's viewed marks, fetched as the Review
 * view mounts, every `REVIEW_RELOAD_MS` while it shows (and the window is
 * visible), and on `refresh` (D8).
 */
export function useReviewData({
  taskId,
  projectId,
  cwd,
  target,
}: {
  taskId: string;
  projectId: string;
  cwd: string;
  target: PrRef;
}): ReviewData {
  const { provider, number } = target;
  const review = usePrReviews((s) => s.byPr[prKey(provider, number)] ?? null);
  const marks = usePrReviews((s) => s.viewed[reviewKey(taskId, provider, number)] ?? NO_MARKS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    const store = usePrReviews.getState();
    void store.loadViewed(taskId, provider, number);
    setLoading(true);
    void store.load(projectId, cwd, number).then((r) => {
      setLoading(false);
      setError(r.ok ? null : r.error);
    });
  }, [taskId, projectId, cwd, provider, number]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REVIEW_RELOAD_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { review, marks, error, loading, refresh };
}
