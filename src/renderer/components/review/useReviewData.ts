import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrRef, PrReview } from '../../../shared/types';
import { useGit } from '../../stores/gitStore';
import { prKey, reviewKey, usePrReviews } from '../../stores/prReviewStore';
import { headMovedPast } from './unpushed';

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
}

/**
 * The target PR's review and the task's viewed marks, fetched as the Review
 * view mounts, every `REVIEW_RELOAD_MS` while it shows (and the window is
 * visible), whenever the window regains focus, and at once when the task's
 * PR lookup finds the PR's head moved past the loaded one (a push, D96).
 * There is no manual refresh.
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

  // `force`: the PR is known to have moved, so a fetch already under way
  // (started before the push) can't answer for it.
  const reload = useCallback(
    (force: boolean) => {
      const store = usePrReviews.getState();
      void store.loadViewed(taskId, provider, number);
      void store.load(projectId, cwd, number, { force }).then((r) => {
        setError(r.ok ? null : r.error);
      });
    },
    [taskId, projectId, cwd, provider, number],
  );
  const refresh = useCallback(() => reload(false), [reload]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REVIEW_RELOAD_MS);
    // Coming back to Dash (say, after reading a reply on the forge) catches
    // up at once instead of on the next tick.
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  // The task's own PR lookup (refetched as HEAD moves) sees a push before the
  // next reload would: reload when its head differs from the loaded one.
  const detectedHead = useGit(
    (s) => s.prByTask[taskId]?.find((p) => p.provider === provider && p.number === number)?.headSha,
  );
  const loadedHead = review?.head;
  const stale = headMovedPast(detectedHead, loadedHead);
  // Once per detected head: a reload that still lands the old head (the
  // forge lagging) doesn't retry until the lookup moves again.
  const reloadedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!stale || reloadedFor.current === detectedHead) return;
    reloadedFor.current = detectedHead;
    reload(true);
  }, [stale, detectedHead, reload]);

  return { review, marks, error };
}
