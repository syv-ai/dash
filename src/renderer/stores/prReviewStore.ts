import { create } from 'zustand';
import type {
  PrProvider,
  PrReview,
  PrReviewSummary,
  PrVerdict,
  PrWriteError,
} from '../../shared/types';

/** The store key of a PR's review. */
export const prKey = (provider: PrProvider, number: number): string => `${provider}:${number}`;

/** The key of a task's review of a PR. */
export const reviewKey = (taskId: string, provider: PrProvider, number: number): string =>
  `${taskId}:${prKey(provider, number)}`;

export type PrLoadResult = { ok: true; review: PrReview } | { ok: false; error: string };
/** `posted`: drafts that reached the PR before the error (ADO posts one at a time). */
export type PrWriteResult = { ok: true } | { ok: false; error: PrWriteError; posted?: number };

interface PrReviewState {
  /** Per PR (`prKey`), its review as last fetched. */
  byPr: Record<string, PrReview>;
  /** Per task and PR (`reviewKey`): whether the task is reviewing it, so what's
   *  written in its view is a comment, not a note. Absent until loaded. */
  inReview: Record<string, boolean>;
  loadInReview: (taskId: string, provider: PrProvider, number: number) => Promise<void>;
  /** Start (Review) or end a task's review of a PR. */
  setInReview: (taskId: string, provider: PrProvider, number: number, on: boolean) => void;
  /** Per task and PR (`reviewKey`): the draft summary, the review's PR-level
   *  comment. Null when there is none; absent until loaded. */
  summaries: Record<string, PrReviewSummary | null>;
  loadSummary: (taskId: string, provider: PrProvider, number: number) => Promise<void>;
  /** The person's edit: shown at once, saved shortly after they stop typing. */
  setSummary: (taskId: string, provider: PrProvider, number: number, body: string) => void;
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
   *  when anything reached the PR, and ends the review when everything did. */
  submit: (
    projectId: string,
    cwd: string,
    taskId: string,
    review: Pick<PrReview, 'provider' | 'number'>,
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

  const markInReview = (key: string, on: boolean) =>
    set({ inReview: { ...get().inReview, [key]: on } });
  const putSummary = (key: string, summary: PrReviewSummary | null) =>
    set({ summaries: { ...get().summaries, [key]: summary } });
  // Saves waiting for the person to stop typing, per review key.
  const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    byPr: {},
    inReview: {},
    summaries: {},

    loadSummary: async (taskId, provider, number) => {
      const key = reviewKey(taskId, provider, number);
      try {
        const resp = await window.electronAPI.prReviewGetSummary({ taskId, provider, number });
        // An edit still being saved wins over what main had.
        if (resp.success && !pendingSaves.has(key)) putSummary(key, resp.data ?? null);
      } catch {
        /* stays as it was */
      }
    },

    setSummary: (taskId, provider, number, body) => {
      const key = reviewKey(taskId, provider, number);
      putSummary(key, { body, author: 'user' });
      clearTimeout(pendingSaves.get(key));
      pendingSaves.set(
        key,
        setTimeout(() => {
          pendingSaves.delete(key);
          void window.electronAPI
            .prReviewSetSummary({ taskId, provider, number, body })
            .catch(() => undefined);
        }, 400),
      );
    },

    loadInReview: async (taskId, provider, number) => {
      try {
        const resp = await window.electronAPI.prReviewInReview({ taskId, provider, number });
        if (resp.success) markInReview(reviewKey(taskId, provider, number), !!resp.data);
      } catch {
        /* stays unknown: writing makes notes */
      }
    },

    setInReview: (taskId, provider, number, on) => {
      markInReview(reviewKey(taskId, provider, number), on);
      void window.electronAPI
        .prReviewSetInReview({ taskId, provider, number, on })
        .catch(() => undefined);
    },

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
        // Main ends the review once everything got through.
        if (!error) {
          const key = reviewKey(taskId, review.provider, review.number);
          markInReview(key, false);
          clearTimeout(pendingSaves.get(key));
          pendingSaves.delete(key);
          putSummary(key, null);
        }
        if (postedDraftIds.length > 0 || !error) await get().load(projectId, cwd, review.number);
        return error ? { ok: false, error, posted: postedDraftIds.length } : { ok: true };
      } catch (err) {
        return { ok: false, error: ipcError(String(err)) };
      }
    },
  };
});

// An agent's summary arrives behind the editor's back; main says the task's
// review drafts changed, and each loaded summary of that task is refetched.
if (typeof window !== 'undefined') {
  window.electronAPI?.onDiffCommentsChanged?.(({ taskId }) => {
    const { summaries, loadSummary } = usePrReviews.getState();
    for (const key of Object.keys(summaries)) {
      const [t, provider, number] = key.split(':');
      if (t === taskId) void loadSummary(t, provider as PrProvider, Number(number));
    }
  });
}
