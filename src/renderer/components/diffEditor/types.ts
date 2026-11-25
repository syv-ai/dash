import type { FileChange, PrProvider } from '../../../shared/types';

/** Which slice of history the user is reviewing. */
export type EditorView =
  | { kind: 'working'; ref: 'HEAD' | 'index' }
  | { kind: 'commit'; hash: string }
  /** A PR's diff: its merge-base against its head, with its review threads.
   *  `live`: the right side is the working-tree file (the checkout is at the
   *  head, clean), editable; otherwise the head, read-only. */
  | {
      kind: 'pr';
      provider: PrProvider;
      number: number;
      base: string;
      head: string;
      live?: boolean;
    };

/** The view's right side is read-only: a commit, or a PR's head that isn't
 *  the live working file. */
export function readOnlyView(view: EditorView): boolean {
  return view.kind === 'commit' || (view.kind === 'pr' && !view.live);
}

/** The commit a view's files are listed at, and what it diffs against
 *  (undefined: its parent): a commit's, or a PR's head (a live PR view's
 *  working tree is that head); null for the working views. */
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
