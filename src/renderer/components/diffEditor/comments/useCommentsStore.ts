import { useCallback, useEffect, useReducer, useRef } from 'react';
import { commentsReducer, initialCommentsState, type CommentsState } from './commentsReducer';
import type { DiffComment, RangeSnapshot } from './types';

interface AddInput {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface CommentsStore {
  /** Empty (`{}`) until `isReady`, then populated from SQLite. */
  state: CommentsState;
  /** False until the initial `diffComments:list` resolves. */
  isReady: boolean;
  /** Disabled when taskId is null — every mutation is a no-op. */
  disabled: boolean;
  addComment(input: AddInput): DiffComment | null;
  updateText(id: string, text: string): void;
  remove(id: string): void;
  markSent(ids: ReadonlyArray<string>): void;
  markUnsent(id: string): void;
  snapshotRanges(filePath: string, snapshots: ReadonlyArray<RangeSnapshot>): void;
  /** Hard-delete any persisted comment whose filePath is not in the given
   *  set. Triggered once per modal open after the repo's file list resolves.
   *  Re-hydrates from SQLite if anything was deleted, so local state matches. */
  prune(existingFilePaths: ReadonlySet<string>): Promise<{ deleted: number }>;
}

/** Task-scoped comments store. Optimistic-applies mutations to local state,
 *  fires the IPC for persistence in the background, and ignores IPC errors
 *  (best-effort persistence; the UI source of truth is the local reducer
 *  state so a transient IPC failure doesn't strand the user). */
export function useCommentsStore(taskId: string | null): CommentsStore {
  const [state, dispatch] = useReducer(commentsReducer, undefined, initialCommentsState);
  const isReadyRef = useRef(false);
  const disabled = taskId === null;
  // The store's commentsByFile is referenced by mutators that need to look
  // up the existing comment to merge with their patch. Reading from `state`
  // directly inside `useCallback` would require putting it in the dep
  // array, which would rebuild every mutator on every state change.
  const stateRef = useRef<CommentsState>(state);
  stateRef.current = state;

  useEffect(() => {
    isReadyRef.current = false;
    if (!taskId) {
      dispatch({ type: 'hydrate', comments: [] });
      isReadyRef.current = true;
      return;
    }
    let cancelled = false;
    void window.electronAPI.diffCommentsList({ taskId }).then((resp) => {
      if (cancelled) return;
      const list = resp.success && resp.data ? resp.data : [];
      dispatch({ type: 'hydrate', comments: list });
      isReadyRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const findById = useCallback((id: string): DiffComment | undefined => {
    for (const list of Object.values(stateRef.current.byFile)) {
      const hit = list.find((c) => c.id === id);
      if (hit) return hit;
    }
    return undefined;
  }, []);

  const addComment = useCallback(
    (input: AddInput): DiffComment | null => {
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
      dispatch({ type: 'upsert', comment });
      void window.electronAPI.diffCommentsUpsert({
        id: comment.id,
        taskId: comment.taskId,
        filePath: comment.filePath,
        startLine: comment.startLine,
        endLine: comment.endLine,
        text: comment.text,
        sent: comment.sent,
      });
      return comment;
    },
    [taskId],
  );

  const updateText = useCallback(
    (id: string, text: string) => {
      if (!taskId) return;
      const existing = findById(id);
      if (!existing) return;
      const next: DiffComment = { ...existing, text, updatedAt: new Date().toISOString() };
      dispatch({ type: 'upsert', comment: next });
      void window.electronAPI.diffCommentsUpsert({
        id: next.id,
        taskId: next.taskId,
        filePath: next.filePath,
        startLine: next.startLine,
        endLine: next.endLine,
        text: next.text,
        sent: next.sent,
      });
    },
    [taskId, findById],
  );

  const remove = useCallback(
    (id: string) => {
      if (!taskId) return;
      dispatch({ type: 'remove', id });
      void window.electronAPI.diffCommentsDelete({ id });
    },
    [taskId],
  );

  const markSent = useCallback(
    (ids: ReadonlyArray<string>) => {
      if (!taskId || ids.length === 0) return;
      dispatch({ type: 'markSent', ids });
      for (const id of ids) {
        const existing = findById(id);
        if (!existing) continue;
        void window.electronAPI.diffCommentsUpsert({
          id: existing.id,
          taskId: existing.taskId,
          filePath: existing.filePath,
          startLine: existing.startLine,
          endLine: existing.endLine,
          text: existing.text,
          sent: true,
        });
      }
    },
    [taskId, findById],
  );

  const markUnsent = useCallback(
    (id: string) => {
      if (!taskId) return;
      dispatch({ type: 'markUnsent', id });
      const existing = findById(id);
      if (!existing) return;
      void window.electronAPI.diffCommentsUpsert({
        id: existing.id,
        taskId: existing.taskId,
        filePath: existing.filePath,
        startLine: existing.startLine,
        endLine: existing.endLine,
        text: existing.text,
        sent: false,
      });
    },
    [taskId, findById],
  );

  const snapshotRanges = useCallback(
    (filePath: string, snapshots: ReadonlyArray<RangeSnapshot>) => {
      if (!taskId || snapshots.length === 0) return;
      dispatch({ type: 'snapshotRanges', filePath, snapshots });
      for (const s of snapshots) {
        const existing = findById(s.id);
        if (!existing) continue;
        void window.electronAPI.diffCommentsUpsert({
          id: existing.id,
          taskId: existing.taskId,
          filePath: existing.filePath,
          startLine: s.startLine,
          endLine: s.endLine,
          text: existing.text,
          sent: existing.sent,
        });
      }
    },
    [taskId, findById],
  );

  const prune = useCallback(
    async (existingFilePaths: ReadonlySet<string>) => {
      if (!taskId) return { deleted: 0 };
      const resp = await window.electronAPI.diffCommentsPruneForTask({
        taskId,
        existingFilePaths: Array.from(existingFilePaths),
      });
      if (!resp.success || !resp.data) return { deleted: 0 };
      if (resp.data.deleted > 0) {
        const list = await window.electronAPI.diffCommentsList({ taskId });
        if (list.success && list.data) {
          dispatch({ type: 'hydrate', comments: list.data });
        }
      }
      return resp.data;
    },
    [taskId],
  );

  return {
    state,
    isReady: isReadyRef.current,
    disabled,
    addComment,
    updateText,
    remove,
    markSent,
    markUnsent,
    snapshotRanges,
    prune,
  };
}
