import { create } from 'zustand';
import type {
  DiffComment,
  DiffCommentKind,
  PrProvider,
  PrRef,
  PrReview,
  PrReviewComment,
  PrReviewSummary,
  PrVerdict,
  PrWriteError,
} from '../../shared/types';

/** The store key of a PR's review. */
export const prKey = (provider: PrProvider, number: number): string => `${provider}:${number}`;

/** The key of a task's review of a PR. */
export const reviewKey = (taskId: string, provider: PrProvider, number: number): string =>
  `${taskId}:${prKey(provider, number)}`;

/** Where a reply on the own PR posts from: the task that drafted it, its
 *  project and checkout, and the PR. */
export interface ReplyPoster {
  projectId: string;
  cwd: string;
  taskId: string;
  review: Pick<PrReview, 'provider' | 'number'>;
}

export type PrLoadResult = { ok: true; review: PrReview } | { ok: false; error: string };
/** `posted`: drafts that reached the PR before the error (ADO posts one at a time). */
export type PrWriteResult = { ok: true } | { ok: false; error: PrWriteError; posted?: number };

interface PrReviewState {
  /** Per PR (`prKey`), its review as last fetched. */
  byPr: Record<string, PrReview>;
  /** Per task: the PR the person picked for it to review, or null. Absent until loaded. */
  targets: Record<string, PrRef | null>;
  /** Per task and PR (`reviewKey`): the files marked viewed, path → the head
   *  blob they were viewed at (`isViewed` says whether a mark still holds).
   *  Absent until loaded. */
  viewed: Record<string, Record<string, string>>;
  /** Per PR (`prKey`): what the person last picked in the composer there,
   *  kept for the session (in memory only). */
  kindPicks: Record<string, DiffCommentKind>;
  /** Remember the composer's kind for a PR. */
  pickKind: (provider: PrProvider, number: number, kind: DiffCommentKind) => void;
  /** Per task and PR (`reviewKey`): the draft summary, the review's PR-level
   *  comment. Null when there is none; absent until loaded. */
  summaries: Record<string, PrReviewSummary | null>;
  /** Fetch a task's review of a PR: its summary. Components read it through
   *  `useTaskReview`, which calls this. */
  loadReview: (taskId: string, provider: PrProvider, number: number) => Promise<void>;
  /** Refetch each loaded summary of the task, after an agent changed it. */
  refreshSummaries: (taskId: string) => Promise<void>;
  /** Fetch the PR the task was set to review. */
  loadTarget: (taskId: string) => Promise<void>;
  /** Pick the PR the task reviews (null stops reviewing): shown at once, saved behind. */
  setTarget: (taskId: string, target: PrRef | null) => void;
  /** Fetch the files of a PR the task marked viewed. */
  loadViewed: (taskId: string, provider: PrProvider, number: number) => Promise<void>;
  /** Mark a file viewed at `blob` (null unmarks it): shown at once, saved behind. */
  setViewed: (
    taskId: string,
    provider: PrProvider,
    number: number,
    path: string,
    blob: string | null,
  ) => void;
  /** The person's edit: shown at once, saved shortly after they stop typing. */
  setSummary: (taskId: string, provider: PrProvider, number: number, body: string) => void;
  /** Fetch PR `number` of the project, with its commits fetched into `cwd`. On
   *  failure the last fetched review stays. A fetch of the same PR already
   *  under way is shared, not repeated. */
  load: (projectId: string, cwd: string, number: number) => Promise<PrLoadResult>;
  /** Resolve or reactivate a thread: shown at once, undone if the PR refuses. */
  setResolved: (
    projectId: string,
    cwd: string,
    review: Pick<PrReview, 'provider' | 'number'>,
    threadId: string,
    resolved: boolean,
  ) => Promise<PrWriteResult>;
  /** Draft replies being posted, by id. */
  posting: Record<string, true>;
  /**
   * Post a draft reply to its thread at once (the own PR's Post reply), and
   * resolve the thread too with `resolve`. Main deletes the draft once
   * posted; the reply joins its thread here. `posted: 1` on an error: the
   * reply went, the resolve didn't. A draft already posting is left alone.
   */
  postReply: (
    poster: ReplyPoster,
    draft: Pick<DiffComment, 'id' | 'replyTo' | 'text'>,
    resolve: boolean,
  ) => Promise<PrWriteResult>;
  /** Submit the task's drafts for the PR with a verdict; refetches the review
   *  when anything reached the PR, and drops the summary when everything did. */
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

  const appendComment = (key: string, threadId: string, comment: PrReviewComment) => {
    const review = get().byPr[key];
    if (!review) return;
    const threads = review.threads.map((t) =>
      t.id === threadId ? { ...t, comments: [...t.comments, comment] } : t,
    );
    set({ byPr: { ...get().byPr, [key]: { ...review, threads } } });
  };
  const setPosting = (id: string, on: boolean) => {
    const posting = { ...get().posting };
    if (on) posting[id] = true;
    else delete posting[id];
    set({ posting });
  };

  const putTarget = (taskId: string, target: PrRef | null) =>
    set({ targets: { ...get().targets, [taskId]: target } });
  const putSummary = (key: string, summary: PrReviewSummary | null) =>
    set({ summaries: { ...get().summaries, [key]: summary } });
  // Fetches under way, per project, checkout and PR number.
  const loading = new Map<string, Promise<PrLoadResult>>();
  // Saves waiting for the person to stop typing, per review key.
  const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

  const loadSummary = async (taskId: string, provider: PrProvider, number: number) => {
    const key = reviewKey(taskId, provider, number);
    try {
      const resp = await window.electronAPI.prReviewGetSummary({ taskId, provider, number });
      // An edit still being saved wins over what main had.
      if (resp.success && !pendingSaves.has(key)) putSummary(key, resp.data ?? null);
    } catch {
      /* stays as it was */
    }
  };

  return {
    byPr: {},
    targets: {},
    viewed: {},
    kindPicks: {},
    summaries: {},
    posting: {},

    pickKind: (provider, number, kind) =>
      set({ kindPicks: { ...get().kindPicks, [prKey(provider, number)]: kind } }),

    loadReview: (taskId, provider, number) => loadSummary(taskId, provider, number),

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

    loadTarget: async (taskId) => {
      try {
        const resp = await window.electronAPI.prReviewTarget({ taskId });
        if (resp.success) putTarget(taskId, resp.data ?? null);
      } catch {
        /* stays unknown */
      }
    },

    setTarget: (taskId, target) => {
      putTarget(taskId, target);
      void window.electronAPI.prReviewSetTarget({ taskId, target }).catch(() => undefined);
    },

    loadViewed: async (taskId, provider, number) => {
      try {
        const resp = await window.electronAPI.prReviewViewed({ taskId, provider, number });
        if (resp.success && resp.data)
          set({ viewed: { ...get().viewed, [reviewKey(taskId, provider, number)]: resp.data } });
      } catch {
        /* stays as it was */
      }
    },

    setViewed: (taskId, provider, number, path, blob) => {
      const key = reviewKey(taskId, provider, number);
      const marks = { ...get().viewed[key] };
      if (blob === null) delete marks[path];
      else marks[path] = blob;
      set({ viewed: { ...get().viewed, [key]: marks } });
      void window.electronAPI
        .prReviewSetViewed({ taskId, provider, number, path, blob })
        .catch(() => undefined);
    },

    load: (projectId, cwd, number) => {
      const key = `${projectId}\0${cwd}\0${number}`;
      const pending = loading.get(key);
      if (pending) return pending;
      const run = (async (): Promise<PrLoadResult> => {
        try {
          const resp = await window.electronAPI.prReviewLoad({ projectId, cwd, number });
          if (!resp.success || !resp.data)
            return { ok: false, error: resp.error ?? 'unknown error' };
          const review = resp.data;
          set({ byPr: { ...get().byPr, [prKey(review.provider, review.number)]: review } });
          return { ok: true, review };
        } catch (err) {
          return { ok: false, error: String(err) };
        } finally {
          loading.delete(key);
        }
      })();
      loading.set(key, run);
      return run;
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

    postReply: async ({ projectId, cwd, taskId, review }, draft, resolve) => {
      const threadId = draft.replyTo;
      if (!threadId) return { ok: false, error: ipcError('not a reply') };
      if (get().posting[draft.id]) return { ok: true };
      setPosting(draft.id, true);
      try {
        const resp = await window.electronAPI.prReviewReply({
          projectId,
          cwd,
          taskId,
          number: review.number,
          threadId,
          body: draft.text,
          draftId: draft.id,
        });
        if (!resp.success || !resp.data)
          return { ok: false, error: ipcError(resp.error ?? 'unknown error') };
        appendComment(prKey(review.provider, review.number), threadId, resp.data);
        if (!resolve) return { ok: true };
        const resolved = await get().setResolved(projectId, cwd, review, threadId, true);
        return resolved.ok ? resolved : { ...resolved, posted: 1 };
      } catch (err) {
        return { ok: false, error: ipcError(String(err)) };
      } finally {
        setPosting(draft.id, false);
      }
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
        // Main clears the summary once everything got through.
        if (!error) {
          const key = reviewKey(taskId, review.provider, review.number);
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
    void usePrReviews.getState().refreshSummaries(taskId);
  });
}
