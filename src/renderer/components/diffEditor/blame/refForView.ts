import { frozenCommit, readOnlyView, type EditorView } from '../types';

/**
 * The git ref to blame against for a view's *modified* side:
 *  - `working` → the working file on disk (no rev → `null`, which the
 *    IPC turns into a plain `git blame` that includes uncommitted lines)
 *  - `commit` → that commit's hash; `pr` → the PR's head, or the working
 *    file when the view is live on it
 */
export function refForView(view: EditorView): string | null {
  return readOnlyView(view) ? (frozenCommit(view)?.hash ?? null) : null;
}
