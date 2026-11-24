import { create } from 'zustand';
import { toast } from 'sonner';
import type { DiffComment, DiffCommentInput, DiffCommentKind } from '../../shared/types';
import { clearedByClearNotes, clearedBySent } from '../../shared/diffComments';

interface AddInput {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  viewScope: string;
  /** A PR draft reply: the remote thread it answers. */
  replyTo?: string | null;
  /** Defaults to 'note'; a 'comment' is a PR review draft. */
  kind?: DiffCommentKind;
  /** A PR line draft: the PR head its lines are in. */
  commit?: string | null;
}
export interface RangeSnapshot {
  id: string;
  startLine: number;
  endLine: number;
}

export interface CommentsState {
  taskId: string | null;
  byFile: Record<string, DiffComment[]>;
  isReady: boolean;
  disabled: boolean;
}

export interface CommentsActions {
  loadForTask: (taskId: string | null) => Promise<void>;
  /** Refetch the loaded task's comments in place (no empty flash), after
   *  they changed outside the editor. */
  reload: () => Promise<void>;
  addComment: (input: AddInput) => DiffComment | null;
  /** Save new text. `from` is the draft as the person started editing it: if
   *  the agent changed or deleted it meanwhile, nothing is overwritten and the
   *  person chooses (a toast: use mine, or keep theirs). */
  updateText: (id: string, text: string, from?: DiffComment) => void;
  /** Anchor a PR line draft to the PR's head (it was written on an older one). */
  setCommit: (id: string, commit: string) => void;
  remove: (id: string) => void;
  markSent: (ids: ReadonlyArray<string>) => void;
  markUnsent: (id: string) => void;
  /** Remove all sent notes, optionally limited to one view scope. PR comments
   *  stay: sending one to the agent doesn't take it off the PR. */
  clearSent: (scope?: string) => void;
  /** Remove every note of a view scope, sent or not (before submitting a PR review). */
  clearNotes: (scope: string) => void;
  /** Make a note a PR comment, or back. */
  setKind: (id: string, kind: DiffCommentKind) => void;
  snapshotRanges: (filePath: string, snapshots: ReadonlyArray<RangeSnapshot>) => void;
  prune: (existingFilePaths: ReadonlySet<string>) => Promise<{ deleted: number }>;
}

export type CommentsStore = CommentsState & CommentsActions;

// ── pure helpers (ported from the former commentsReducer) ──
function groupByFile(comments: DiffComment[]): Record<string, DiffComment[]> {
  const byFile: Record<string, DiffComment[]> = {};
  for (const c of comments) (byFile[c.filePath] ??= []).push(c);
  for (const list of Object.values(byFile)) list.sort((a, b) => a.startLine - b.startLine);
  return byFile;
}
function stripById(
  byFile: Record<string, DiffComment[]>,
  id: string,
): Record<string, DiffComment[]> {
  const next: Record<string, DiffComment[]> = {};
  for (const [path, list] of Object.entries(byFile)) {
    const filtered = list.filter((c) => c.id !== id);
    if (filtered.length > 0) next[path] = filtered;
  }
  return next;
}
function stripByIds(
  byFile: Record<string, DiffComment[]>,
  ids: ReadonlySet<string>,
): Record<string, DiffComment[]> {
  const next: Record<string, DiffComment[]> = {};
  for (const [path, list] of Object.entries(byFile)) {
    const filtered = list.filter((c) => !ids.has(c.id));
    if (filtered.length > 0) next[path] = filtered;
  }
  return next;
}
function upsertInto(
  byFile: Record<string, DiffComment[]>,
  comment: DiffComment,
): Record<string, DiffComment[]> {
  const next = stripById(byFile, comment.id);
  const list = (next[comment.filePath] ??= []);
  list.push(comment);
  list.sort((a, b) => a.startLine - b.startLine);
  return next;
}
function mapAll(
  byFile: Record<string, DiffComment[]>,
  fn: (c: DiffComment) => DiffComment,
): Record<string, DiffComment[]> {
  const next: Record<string, DiffComment[]> = {};
  for (const [path, list] of Object.entries(byFile)) next[path] = list.map(fn);
  return next;
}
function findById(byFile: Record<string, DiffComment[]>, id: string): DiffComment | undefined {
  for (const list of Object.values(byFile)) {
    const hit = list.find((c) => c.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Task-scoped comments store. Optimistic-applies mutations to local state,
 *  fires the IPC for persistence in the background, and ignores IPC errors
 *  (best-effort persistence; local state is the UI source of truth). Matches
 *  the app's other Zustand stores — driveable under node via getState(). */
export const useCommentsStore = create<CommentsStore>((set, get) => {
  /**
   * How a write is checked against the row in main:
   * - `{ since }`: an edit of the text, from the version editing began at;
   * - 'current': a change made in the editor (kind, sent, range, commit), built
   *   from the row as the store holds it when the write runs, and checked
   *   against that version;
   * - 'none': a new row, or the person putting their own text back.
   * A refused write means the agent got there first.
   */
  type Guard = { since: string } | 'current' | 'none';
  type UpsertResponse = Awaited<ReturnType<typeof window.electronAPI.diffCommentsUpsert>>;
  // One row's writes go one after another, so each builds on the version the
  // one before it got back.
  const queues = new Map<string, Promise<unknown>>();

  /** Write a comment, then take main's word on what it decides: its version
   *  (updatedAt), and who owns it (an agent's draft becomes the user's once
   *  they change its text). */
  // The versions the person's own writes moved each row through ('id@from' →
  // to): a text edit begun before them is still built on what the person saw.
  const ownVersions = new Map<string, string>();
  const latestOwn = (id: string, version: string) => {
    let v = version;
    for (let next = ownVersions.get(`${id}@${v}`); next; next = ownVersions.get(`${id}@${v}`)) {
      v = next;
    }
    return v;
  };

  /** Write a comment, then take main's word on what it decides: its version
   *  (updatedAt), and who owns it (an agent's draft becomes the user's once
   *  they change its text). */
  const persist = (
    c: DiffComment,
    patch: Partial<DiffCommentInput> = {},
    guard: Guard = 'current',
  ): Promise<UpsertResponse | undefined> => {
    const write = async (): Promise<UpsertResponse | undefined> => {
      const base = guard === 'current' ? findById(get().byFile, c.id) : c;
      // Gone from the store (deleted, or reloaded away): nothing left to change.
      if (!base) return undefined;
      const since =
        guard === 'none'
          ? undefined
          : guard === 'current'
            ? base.updatedAt
            : latestOwn(base.id, guard.since);
      let resp: UpsertResponse | undefined;
      try {
        resp = await window.electronAPI.diffCommentsUpsert({
          id: base.id,
          taskId: base.taskId,
          filePath: base.filePath,
          startLine: base.startLine,
          endLine: base.endLine,
          text: base.text,
          sent: base.sent,
          viewScope: base.viewScope,
          side: base.side,
          replyTo: base.replyTo,
          kind: base.kind,
          commit: base.commit,
          ...patch,
          ...(since === undefined ? {} : { ifUnchangedSince: since }),
        });
      } catch {
        return undefined; // best effort, like the rest of the store
      }
      const saved = resp?.success ? resp.data : undefined;
      if (saved) {
        ownVersions.set(`${saved.id}@${since ?? base.updatedAt}`, saved.updatedAt);
        // What this write set, as main has it now (a reload may have come in between).
        const now = findById(get().byFile, saved.id);
        if (now) {
          set((st) => ({
            byFile: upsertInto(st.byFile, {
              ...now,
              ...patch,
              updatedAt: saved.updatedAt,
              author: saved.author,
            }),
          }));
        }
      }
      if (guard === 'current' && resp && !resp.success && resp.code === 'CONFLICT') {
        await get()
          .reload()
          .catch(() => undefined);
        toast.info("The agent changed this draft first, so your change wasn't applied.");
      }
      return resp;
    };
    // With nothing in flight for the row, write now; otherwise after the last one.
    const prev = queues.get(c.id);
    const queued = prev ? prev.then(write, write) : write();
    queues.set(c.id, queued);
    void queued
      .finally(() => {
        if (queues.get(c.id) === queued) queues.delete(c.id);
      })
      .catch(() => undefined);
    return queued;
  };

  /** The agent changed or deleted a draft the person was editing: show it as
   *  it is now, and let them put their text back. */
  const onConflict = async (mine: DiffComment, current: DiffComment | undefined) => {
    await get().reload();
    toast(
      current
        ? 'The agent changed this draft while you were editing it.'
        : 'This draft was deleted while you were editing it (by the agent, or posted by a submit).',
      {
        id: `draft-conflict-${mine.id}`,
        description: mine.text.length > 80 ? `${mine.text.slice(0, 80)}…` : mine.text,
        duration: Infinity,
        action: {
          label: current ? 'Use mine' : 'Restore mine',
          onClick: () => {
            if (current) {
              get().updateText(mine.id, mine.text);
            } else {
              set((st) => ({ byFile: upsertInto(st.byFile, mine) }));
              void persist(mine, {}, 'none');
            }
          },
        },
        cancel: { label: current ? 'Keep theirs' : 'Discard', onClick: () => {} },
      },
    );
  };

  const removeWhere = (pred: (c: DiffComment) => boolean) => {
    if (!get().taskId) return;
    const ids: string[] = [];
    for (const list of Object.values(get().byFile))
      for (const c of list) if (pred(c)) ids.push(c.id);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    set((s) => ({ byFile: stripByIds(s.byFile, idSet) }));
    for (const id of ids) void window.electronAPI.diffCommentsDelete({ id });
  };

  return {
    taskId: null,
    byFile: {},
    isReady: false,
    disabled: true,

    loadForTask: async (taskId) => {
      set({ taskId, disabled: taskId === null, isReady: false, byFile: {} });
      if (!taskId) {
        set({ isReady: true });
        return;
      }
      const resp = await window.electronAPI.diffCommentsList({ taskId });
      // Guard against a racing loadForTask for a different task.
      if (get().taskId !== taskId) return;
      const list = resp.success && resp.data ? resp.data : [];
      set({ byFile: groupByFile(list), isReady: true });
    },

    reload: async () => {
      const taskId = get().taskId;
      if (!taskId) return;
      const resp = await window.electronAPI.diffCommentsList({ taskId });
      if (get().taskId !== taskId || !resp.success || !resp.data) return;
      set({ byFile: groupByFile(resp.data) });
    },

    addComment: (input) => {
      const taskId = get().taskId;
      if (!taskId) return null;
      const now = new Date().toISOString();
      const comment: DiffComment = {
        id: crypto.randomUUID(),
        taskId,
        filePath: input.filePath,
        startLine: input.startLine,
        endLine: input.endLine,
        text: input.text,
        sent: false,
        viewScope: input.viewScope,
        side: 'RIGHT',
        replyTo: input.replyTo ?? null,
        commit: input.commit ?? null,
        author: 'user',
        kind: input.kind ?? 'note',
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({ byFile: upsertInto(s.byFile, comment) }));
      void persist(comment, {}, 'none');
      return comment;
    },

    updateText: (id, text, from) => {
      if (!get().taskId) return;
      const existing = findById(get().byFile, id);
      if (!existing) {
        // Deleted while the person edited it (the reload got here first).
        if (from) void onConflict({ ...from, text }, undefined);
        return;
      }
      const next: DiffComment = { ...existing, text };
      set((s) => ({ byFile: upsertInto(s.byFile, next) }));
      if (!from) {
        void persist(existing, { text });
        return;
      }
      void persist(next, {}, { since: from.updatedAt }).then((resp) => {
        if (resp && !resp.success && resp.code === 'CONFLICT') {
          void onConflict(next, (resp.data as DiffComment | null | undefined) ?? undefined);
        }
      });
    },

    setCommit: (id, commit) => {
      if (!get().taskId) return;
      const existing = findById(get().byFile, id);
      if (!existing || existing.commit === commit) return;
      const next: DiffComment = { ...existing, commit };
      set((s) => ({ byFile: upsertInto(s.byFile, next) }));
      void persist(next, { commit });
    },

    remove: (id) => {
      if (!get().taskId) return;
      set((s) => ({ byFile: stripById(s.byFile, id) }));
      void window.electronAPI.diffCommentsDelete({ id });
    },

    markSent: (ids) => {
      if (!get().taskId || ids.length === 0) return;
      const idSet = new Set(ids);
      set((s) => ({
        byFile: mapAll(s.byFile, (c) => (idSet.has(c.id) ? { ...c, sent: true } : c)),
      }));
      for (const id of ids) {
        const existing = findById(get().byFile, id);
        if (existing) void persist(existing, { sent: true });
      }
    },

    markUnsent: (id) => {
      if (!get().taskId) return;
      set((s) => ({ byFile: mapAll(s.byFile, (c) => (c.id === id ? { ...c, sent: false } : c)) }));
      const existing = findById(get().byFile, id);
      if (existing) void persist(existing, { sent: false });
    },

    clearSent: (scope) => removeWhere((c) => clearedBySent(c, scope)),

    clearNotes: (scope) => removeWhere((c) => clearedByClearNotes(c, scope)),

    setKind: (id, kind) => {
      if (!get().taskId) return;
      const existing = findById(get().byFile, id);
      if (!existing || existing.kind === kind) return;
      const next: DiffComment = { ...existing, kind };
      set((s) => ({ byFile: upsertInto(s.byFile, next) }));
      void persist(next, { kind });
    },

    snapshotRanges: (filePath, all) => {
      if (!get().taskId) return;
      // Only ranges that moved: an unchanged write would still be a new version,
      // and tell an agent the person changed a draft they only looked at.
      const snapshots = all.filter((snap) => {
        const c = findById(get().byFile, snap.id);
        return c && (c.startLine !== snap.startLine || c.endLine !== snap.endLine);
      });
      if (snapshots.length === 0) return;
      const patches = new Map(snapshots.map((s) => [s.id, s]));
      set((s) => {
        const list = s.byFile[filePath];
        if (!list) return {};
        const updated = list.map((c) => {
          const p = patches.get(c.id);
          return p ? { ...c, startLine: p.startLine, endLine: p.endLine } : c;
        });
        return { byFile: { ...s.byFile, [filePath]: updated } };
      });
      for (const snap of snapshots) {
        const existing = findById(get().byFile, snap.id);
        if (existing) void persist(existing, { startLine: snap.startLine, endLine: snap.endLine });
      }
    },

    prune: async (existingFilePaths) => {
      const taskId = get().taskId;
      if (!taskId) return { deleted: 0 };
      const resp = await window.electronAPI.diffCommentsPruneForTask({
        taskId,
        existingFilePaths: Array.from(existingFilePaths),
      });
      if (!resp.success || !resp.data) return { deleted: 0 };
      if (resp.data.deleted > 0) {
        const list = await window.electronAPI.diffCommentsList({ taskId });
        if (get().taskId === taskId && list.success && list.data) {
          set({ byFile: groupByFile(list.data) });
        }
      }
      return resp.data;
    },
  };
});

// An agent's draft or a submit changes the loaded task's comments behind the
// editor's back; main says so, and the store refetches them.
if (typeof window !== 'undefined') {
  window.electronAPI?.onDiffCommentsChanged?.(({ taskId }) => {
    if (useCommentsStore.getState().taskId === taskId) void useCommentsStore.getState().reload();
  });
}
