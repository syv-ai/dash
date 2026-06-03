import type { FileChange } from '../../../shared/types';

/** Which slice of history the user is reviewing. */
export type EditorView =
  | { kind: 'working'; ref: 'HEAD' | 'index' }
  | { kind: 'commit'; hash: string };

export interface CommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  /** Full commit body (without subject); '' when the commit has no body. */
  body: string;
  authorName: string;
  authorDate: number;
}

/** A file in the current view's tree. Reuses the project's FileChange shape. */
export type EditorFile = FileChange;

/** A comment persisted in the parent so it survives file switches. Holds
 *  line numbers rather than decoration ids — decorations are tied to a
 *  Monaco model and get wiped when the model's content swaps. The EditorPane
 *  re-creates decorations from this shape every time a file loads, and
 *  snapshots back to it (with any shifted ranges from edits) on file switch. */
export interface StoredComment {
  id: string;
  startLine: number;
  endLine: number;
  text: string;
}
