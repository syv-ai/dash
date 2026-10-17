import { create } from 'zustand';
import type { PrReview } from '../../shared/types';

interface PrReviewState {
  /** Per task, its open PR's unresolved review threads as last fetched. */
  byTask: Record<string, PrReview>;
  /** Fetch PR `number`'s review for the task checked out at `cwd`; null (keeping the last one) on failure. */
  load: (taskId: string, cwd: string, number: number) => Promise<PrReview | null>;
}

export const usePrReviews = create<PrReviewState>((set, get) => ({
  byTask: {},
  load: async (taskId, cwd, number) => {
    try {
      const resp = await window.electronAPI.githubGetPrReview({ cwd, number });
      if (!resp.success || !resp.data) return null;
      set({ byTask: { ...get().byTask, [taskId]: resp.data } });
      return resp.data;
    } catch {
      return null;
    }
  },
}));
