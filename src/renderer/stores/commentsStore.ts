import { create } from 'zustand';
import type { DiffComment } from '../../shared/types';

interface AddInput {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
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
  addComment: (input: AddInput) => DiffComment | null;
  updateText: (id: string, text: string) => void;
  remove: (id: string) => void;
  markSent: (ids: ReadonlyArray<string>) => void;
  markUnsent: (id: string) => void;
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
function persist(c: DiffComment, patch: Partial<DiffComment> = {}): void {
  void window.electronAPI.diffCommentsUpsert({
    id: c.id,
    taskId: c.taskId,
    filePath: c.filePath,
    startLine: c.startLine,
    endLine: c.endLine,
    text: c.text,
    sent: c.sent,
    ...patch,
  });
}

/** Task-scoped comments store. Optimistic-applies mutations to local state,
 *  fires the IPC for persistence in the background, and ignores IPC errors
 *  (best-effort persistence; local state is the UI source of truth). Matches
 *  the app's other Zustand stores — driveable under node via getState(). */
export const useCommentsStore = create<CommentsStore>((set, get) => ({
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
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ byFile: upsertInto(s.byFile, comment) }));
    persist(comment);
    return comment;
  },

  updateText: (id, text) => {
    if (!get().taskId) return;
    const existing = findById(get().byFile, id);
    if (!existing) return;
    const next: DiffComment = { ...existing, text, updatedAt: new Date().toISOString() };
    set((s) => ({ byFile: upsertInto(s.byFile, next) }));
    persist(next);
  },

  remove: (id) => {
    if (!get().taskId) return;
    set((s) => ({ byFile: stripById(s.byFile, id) }));
    void window.electronAPI.diffCommentsDelete({ id });
  },

  markSent: (ids) => {
    if (!get().taskId || ids.length === 0) return;
    const idSet = new Set(ids);
    set((s) => ({ byFile: mapAll(s.byFile, (c) => (idSet.has(c.id) ? { ...c, sent: true } : c)) }));
    for (const id of ids) {
      const existing = findById(get().byFile, id);
      if (existing) persist(existing, { sent: true });
    }
  },

  markUnsent: (id) => {
    if (!get().taskId) return;
    set((s) => ({ byFile: mapAll(s.byFile, (c) => (c.id === id ? { ...c, sent: false } : c)) }));
    const existing = findById(get().byFile, id);
    if (existing) persist(existing, { sent: false });
  },

  snapshotRanges: (filePath, snapshots) => {
    if (!get().taskId || snapshots.length === 0) return;
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
      if (existing) persist(existing, { startLine: snap.startLine, endLine: snap.endLine });
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
}));
