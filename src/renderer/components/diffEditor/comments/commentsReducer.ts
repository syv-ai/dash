import type { DiffComment, RangeSnapshot } from './types';

export interface CommentsState {
  byFile: Record<string, DiffComment[]>;
}

export type CommentsAction =
  | { type: 'hydrate'; comments: DiffComment[] }
  | { type: 'upsert'; comment: DiffComment }
  | { type: 'remove'; id: string }
  | { type: 'markSent'; ids: ReadonlyArray<string> }
  | { type: 'markUnsent'; id: string }
  | { type: 'snapshotRanges'; filePath: string; snapshots: ReadonlyArray<RangeSnapshot> };

export function initialCommentsState(): CommentsState {
  return { byFile: {} };
}

/** Pure reducer. Stable bucket key = filePath. Empty buckets are deleted so
 *  the store's keys reflect "files that currently have comments". */
export function commentsReducer(state: CommentsState, action: CommentsAction): CommentsState {
  switch (action.type) {
    case 'hydrate': {
      const byFile: Record<string, DiffComment[]> = {};
      for (const c of action.comments) {
        (byFile[c.filePath] ??= []).push(c);
      }
      for (const list of Object.values(byFile)) {
        list.sort((a, b) => a.startLine - b.startLine);
      }
      return { byFile };
    }
    case 'upsert': {
      const next = stripById(state.byFile, action.comment.id);
      const list = (next[action.comment.filePath] ??= []);
      list.push(action.comment);
      list.sort((a, b) => a.startLine - b.startLine);
      return { byFile: next };
    }
    case 'remove': {
      const next = stripById(state.byFile, action.id);
      return { byFile: next };
    }
    case 'markSent': {
      const ids = new Set(action.ids);
      const next = mapAll(state.byFile, (c) => (ids.has(c.id) ? { ...c, sent: true } : c));
      return { byFile: next };
    }
    case 'markUnsent': {
      const next = mapAll(state.byFile, (c) => (c.id === action.id ? { ...c, sent: false } : c));
      return { byFile: next };
    }
    case 'snapshotRanges': {
      const patches = new Map(action.snapshots.map((s) => [s.id, s]));
      const list = state.byFile[action.filePath];
      if (!list) return state;
      const updated = list.map((c) => {
        const p = patches.get(c.id);
        return p ? { ...c, startLine: p.startLine, endLine: p.endLine } : c;
      });
      return { byFile: { ...state.byFile, [action.filePath]: updated } };
    }
  }
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

function mapAll(
  byFile: Record<string, DiffComment[]>,
  fn: (c: DiffComment) => DiffComment,
): Record<string, DiffComment[]> {
  const next: Record<string, DiffComment[]> = {};
  for (const [path, list] of Object.entries(byFile)) {
    next[path] = list.map(fn);
  }
  return next;
}
