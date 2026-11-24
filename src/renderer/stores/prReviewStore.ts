import { create } from 'zustand';
import { toast } from 'sonner';
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
/** `heldBack`: line comments a submit kept as drafts, written on an older head of the
 *  PR; `posted`: the drafts that reached it. */
export type PrWriteResult =
  | { ok: true; heldBack?: number; posted?: number }
  | { ok: false; error: PrWriteError; posted?: number };

interface PrReviewState {
  /** Per PR (`prKey`), its review as last fetched. */
  byPr: Record<string, PrReview>;
  /** Per task and PR (`reviewKey`): whether the task is reviewing it, so what's
   *  written in its view is a comment, not a note. Absent until loaded. */
  inReview: Record<string, boolean>;
  /** Per task and PR (`reviewKey`): the draft summary, the review's PR-level
   *  comment. Null when there is none; absent until loaded. */
  summaries: Record<string, PrReviewSummary | null>;
  /** Fetch a task's review of a PR: whether it's in review, and its summary.
   *  Components read it through `useTaskReview`, which calls this. */
  loadReview: (taskId: string, provider: PrProvider, number: number) => Promise<void>;
  /** Refetch each loaded summary of the task, after an agent changed it. */
  refreshSummaries: (taskId: string) => Promise<void>;
  /** Start (Review) or end a task's review of a PR. */
  setInReview: (taskId: string, provider: PrProvider, number: number, on: boolean) => void;
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
   *  when anything reached the PR, and ends the review when everything did
   *  (drafts written on an older head are held back, keeping it going). */
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
  /** Per review, the stored summary's version ('' for none) the person's typing
   *  builds on: a save from it doesn't overwrite what the agent wrote since. */
  const summaryBase = new Map<string, string>();
  /** Per review, the person's summary text not yet saved (typed, or refused by a
   *  conflict): a reload doesn't replace it, and "Use mine" saves it. */
  const unsaved = new Map<string, string>();

  /**
   * Save the person's summary, built on version `since` (null: regardless). If
   * the agent rewrote it since, nothing is overwritten: one toast per review
   * (typing on updates it) lets the person keep theirs or use their own.
   */
  const saveSummary = async (
    taskId: string,
    provider: PrProvider,
    number: number,
    body: string,
    since: string | null,
  ) => {
    const key = reviewKey(taskId, provider, number);
    const cancelPending = () => {
      clearTimeout(pendingSaves.get(key));
      pendingSaves.delete(key);
    };
    try {
      const resp = await window.electronAPI.prReviewSetSummary({
        taskId,
        provider,
        number,
        body,
        ...(since === null ? {} : { ifUnchangedSince: since }),
      });
      if (resp.success) {
        summaryBase.set(key, resp.data?.updatedAt ?? '');
        // Typing since this save was sent is still unsaved.
        if (unsaved.get(key) === body) unsaved.delete(key);
        return;
      }
      if (resp.code !== 'CONFLICT') return;
      const theirs = (resp.data as PrReviewSummary | null | undefined) ?? null;
      const said = theirs?.body ?? '';
      toast('The agent rewrote the review summary while you were writing it.', {
        id: `summary-conflict-${key}`,
        description: said
          ? `Theirs: ${said.length > 80 ? `${said.slice(0, 80)}…` : said}`
          : 'They cleared it.',
        duration: Infinity,
        action: {
          label: 'Use mine',
          onClick: () => {
            cancelPending();
            const mine = unsaved.get(key) ?? body;
            putSummary(key, { body: mine, author: 'user' });
            void saveSummary(taskId, provider, number, mine, null);
          },
        },
        cancel: {
          label: 'Keep theirs',
          onClick: () => {
            cancelPending();
            unsaved.delete(key);
            putSummary(key, theirs);
            summaryBase.set(key, theirs?.updatedAt ?? '');
          },
        },
      });
    } catch {
      /* stays as typed; the next edit saves again */
    }
  };

  const loadInReview = async (taskId: string, provider: PrProvider, number: number) => {
    try {
      const resp = await window.electronAPI.prReviewInReview({ taskId, provider, number });
      if (resp.success) markInReview(reviewKey(taskId, provider, number), !!resp.data);
    } catch {
      /* stays unknown: writing makes notes */
    }
  };
  const loadSummary = async (taskId: string, provider: PrProvider, number: number) => {
    const key = reviewKey(taskId, provider, number);
    try {
      const resp = await window.electronAPI.prReviewGetSummary({ taskId, provider, number });
      // An edit not yet saved wins over what main had.
      if (resp.success && !unsaved.has(key)) {
        putSummary(key, resp.data ?? null);
        summaryBase.set(key, resp.data?.updatedAt ?? '');
      }
    } catch {
      /* stays as it was */
    }
  };

  return {
    byPr: {},
    inReview: {},
    summaries: {},

    loadReview: async (taskId, provider, number) => {
      await Promise.all([
        loadInReview(taskId, provider, number),
        loadSummary(taskId, provider, number),
      ]);
    },

    refreshSummaries: async (taskId) => {
      const loads = Object.keys(get().summaries).flatMap((key) => {
        const [t, provider, number] = key.split(':');
        return t === taskId ? [loadSummary(t, provider as PrProvider, Number(number))] : [];
      });
      await Promise.all(loads);
    },

    setSummary: (taskId, provider, number, body) => {
      const key = reviewKey(taskId, provider, number);
      putSummary(key, { body, author: 'user' });
      unsaved.set(key, body);
      clearTimeout(pendingSaves.get(key));
      pendingSaves.set(
        key,
        setTimeout(() => {
          pendingSaves.delete(key);
          // Before the stored summary has loaded, build on "none": one the agent
          // already wrote isn't overwritten unseen.
          void saveSummary(taskId, provider, number, body, summaryBase.get(key) ?? '');
        }, 400),
      );
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
        const { postedDraftIds, error, heldBackDraftIds = [] } = resp.data;
        // Main clears the summary once the submit got through, and ends the
        // review unless it held drafts back.
        if (!error) {
          const key = reviewKey(taskId, review.provider, review.number);
          if (heldBackDraftIds.length === 0) markInReview(key, false);
          clearTimeout(pendingSaves.get(key));
          pendingSaves.delete(key);
          unsaved.delete(key);
          putSummary(key, null);
          summaryBase.set(key, '');
        }
        if (postedDraftIds.length > 0 || !error) await get().load(projectId, cwd, review.number);
        if (error) return { ok: false, error, posted: postedDraftIds.length };
        return heldBackDraftIds.length > 0
          ? { ok: true, heldBack: heldBackDraftIds.length, posted: postedDraftIds.length }
          : { ok: true };
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
    void usePrReviews.getState().refreshSummaries(taskId);
  });
}
