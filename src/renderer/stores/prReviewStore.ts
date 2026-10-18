import { create } from 'zustand';
import type { PrProvider, PrReview } from '../../shared/types';

/** The store key of a PR's review. */
export const prKey = (provider: PrProvider, number: number): string => `${provider}:${number}`;

export type PrLoadResult = { ok: true; review: PrReview } | { ok: false; error: string };

interface PrReviewState {
  /** Per PR (`prKey`), its review as last fetched. */
  byPr: Record<string, PrReview>;
  /** Fetch PR `number` of the project, with its commits fetched into `cwd`. On
   *  failure the last fetched review stays. */
  load: (projectId: string, cwd: string, number: number) => Promise<PrLoadResult>;
}

export const usePrReviews = create<PrReviewState>((set, get) => ({
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
}));
