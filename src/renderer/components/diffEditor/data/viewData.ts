import type { EditorView, CommitSummary } from '../types';
import type { FileChange } from '../../../../shared/types';

/** If `view` is the {commit, hash:'HEAD'} sentinel and commits are known,
 *  resolve it to the latest concrete hash. Otherwise return `view` unchanged
 *  (same reference, so callers can skip a setState). */
export function resolveHeadSentinel(view: EditorView, commits: CommitSummary[]): EditorView {
  if (view.kind === 'commit' && view.hash === 'HEAD' && commits.length > 0) {
    return { kind: 'commit', hash: commits[0]!.hash };
  }
  return view;
}

/** First changed file's path for the auto-pick-on-empty-selection behavior. */
export function pickFirstChangedFile(changedFiles: FileChange[]): string | null {
  return changedFiles.length > 0 ? changedFiles[0]!.path : null;
}
