import type { FileChange } from '../../../shared/types';

/** Which slice of history the user is reviewing. */
export type EditorView =
  | { kind: 'working'; ref: 'HEAD' | 'index' }
  | { kind: 'commit'; hash: string }
  | { kind: 'branch'; base: string };

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
