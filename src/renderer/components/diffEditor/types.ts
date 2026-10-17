import type { FileChange } from '../../../shared/types';

/** Which slice of history the user is reviewing. */
export type EditorView =
  | { kind: 'working'; ref: 'HEAD' | 'index' }
  | { kind: 'commit'; hash: string }
  | { kind: 'branch'; base: string }
  /** A PR's diff: its merge-base against its head, read-only, with its review threads. */
  | { kind: 'pr'; number: number; base: string; head: string };

/** The frozen commit a read-only view shows, and what it diffs against
 *  (undefined: its parent); null for the live views. */
export function frozenCommit(view: EditorView): { hash: string; base?: string } | null {
  if (view.kind === 'commit') return { hash: view.hash };
  if (view.kind === 'pr') return { hash: view.head, base: view.base };
  return null;
}

export interface CommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  /** Full commit body (without subject); '' when the commit has no body. */
  body: string;
  authorName: string;
  authorDate: number;
  /** Lines added/removed by this commit (0 for merges). */
  additions: number;
  deletions: number;
}

/** A file in the current view's tree. Reuses the project's FileChange shape. */
export type EditorFile = FileChange;
