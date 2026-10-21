import { useCallback, useEffect } from 'react';
import type { PrProvider, PrReviewSummary } from '../../../../shared/types';
import { reviewKey, usePrReviews } from '../../../stores/prReviewStore';

export interface TaskReviewState {
  /** The task is reviewing the PR: what's written in its view is a PR comment, not a note. */
  inReview: boolean;
  /** The review's draft summary, its PR-level comment; null when there is none. */
  summary: PrReviewSummary | null;
  /** Start (Review) or end the review. */
  setInReview: (on: boolean) => void;
  /** The person's edit: shown at once, saved once they stop typing. */
  setSummary: (body: string) => void;
}

/**
 * A task's review of a PR, loaded on mount, so a caller only reads and acts.
 * Without a task or a PR it's an inert empty review. Summaries an agent writes
 * arrive through the store's change-event refresh.
 */
export function useTaskReview(
  taskId: string | null,
  pr: { provider: PrProvider; number: number } | null,
): TaskReviewState {
  const provider = pr?.provider;
  const number = pr?.number;
  const key =
    taskId && provider && number !== undefined ? reviewKey(taskId, provider, number) : null;
  const inReview = usePrReviews((s) => (key ? s.inReview[key] === true : false));
  const summary = usePrReviews((s) => (key ? (s.summaries[key] ?? null) : null));

  useEffect(() => {
    if (!taskId || !provider || number === undefined) return;
    void usePrReviews.getState().loadReview(taskId, provider, number);
  }, [taskId, provider, number]);

  const setInReview = useCallback(
    (on: boolean) => {
      if (taskId && provider && number !== undefined)
        usePrReviews.getState().setInReview(taskId, provider, number, on);
    },
    [taskId, provider, number],
  );
  const setSummary = useCallback(
    (body: string) => {
      if (taskId && provider && number !== undefined)
        usePrReviews.getState().setSummary(taskId, provider, number, body);
    },
    [taskId, provider, number],
  );
  return { inReview, summary, setInReview, setSummary };
}
