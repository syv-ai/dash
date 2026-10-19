import { create } from 'zustand';
import type { PrProvider, PrReview, PrVerdict, PrWriteError } from '../../shared/types';

/** The store key of a PR's review. */
export const prKey = (provider: PrProvider, number: number): string => `${provider}:${number}`;

export type PrLoadResult = { ok: true; review: PrReview } | { ok: false; error: string };
/** `posted`: drafts that reached the PR before the error (ADO posts one at a time). */
export type PrWriteResult = { ok: true } | { ok: false; error: PrWriteError; posted?: number };

interface PrReviewState {
  /** Per PR (`prKey`), its review as last fetched. */
  byPr: Record<string, PrReview>;
  /** Fetch PR `number` of the project, with its commits fetched into `cwd`. On
   *  failure the last fetched review stays. */
  load: (projectId: string, cwd: string, number: number) => Promise<PrLoadResult>;
  /** Resolve or reactivate a thread: shown at once, undone if the PR refuses. */
  setResolved: (
    projectId: string,
    cwd: string,
    review: Pick<PrReview, 'provider' | 'number'>,
    threadId: string,
    resolved: boolean,
  ) => Promise<PrWriteResult>;
  /** Submit the task's drafts for the PR with a verdict; refetches the review
   *  when anything reached the PR. */
  submit: (
    projectId: string,
    cwd: string,
    taskId: string,
    review: Pick<PrReview, 'number'>,
    verdict: PrVerdict,
    body: string,
  ) => Promise<PrWriteResult>;
}

const ipcError = (message: string): PrWriteError => ({ kind: 'other', message });

export const usePrReviews = create<PrReviewState>((set, get) => {
  const flip = (key: string, threadId: string, resolved: boolean) => {
    const review = get().byPr[key];
    if (!review) return;
    const threads = review.threads.map((t) => (t.id === threadId ? { ...t, resolved } : t));
    set({ byPr: { ...get().byPr, [key]: { ...review, threads } } });
  };

  return {
    byPr: {},

    load: async (projectId, cwd, number) => {
      try {
        const resp = await window.electronAPI.prReviewLoad({ projectId, cwd, number });
        if (!resp.success || !resp.data) return { ok: false, error: resp.error ?? 'unknown error' };
        const review = resp.data;
        set({ byPr: { ...get().byPr, [prKey(review.provider, review.number)]: review } });
        return { ok: true, review };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    setResolved: async (projectId, cwd, review, threadId, resolved) => {
      const key = prKey(review.provider, review.number);
      flip(key, threadId, resolved);
      let error: PrWriteError | null = null;
      try {
        const resp = await window.electronAPI.prReviewSetResolved({
          projectId,
          cwd,
          number: review.number,
          threadId,
          resolved,
        });
        if (!resp.success) error = ipcError(resp.error ?? 'unknown error');
      } catch (err) {
        error = ipcError(String(err));
      }
      if (!error) return { ok: true };
      flip(key, threadId, !resolved);
      return { ok: false, error };
    },

    submit: async (projectId, cwd, taskId, review, verdict, body) => {
      try {
        const resp = await window.electronAPI.prReviewSubmit({
          projectId,
          cwd,
          taskId,
          number: review.number,
          verdict,
          body,
        });
        if (!resp.success || !resp.data)
          return { ok: false, error: ipcError(resp.error ?? 'unknown error') };
        const { postedDraftIds, error } = resp.data;
        if (postedDraftIds.length > 0 || !error) await get().load(projectId, cwd, review.number);
        return error ? { ok: false, error, posted: postedDraftIds.length } : { ok: true };
      } catch (err) {
        return { ok: false, error: ipcError(String(err)) };
      }
    },
  };
});
