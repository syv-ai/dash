import { frozenCommit, type EditorView } from '../types';

/**
 * The git ref to blame against for a view's *modified* side:
 *  - `working` / `branch` → the working file on disk (no rev → `null`, which the
 *    IPC turns into a plain `git blame` that includes uncommitted lines)
 *  - `commit` → that commit's hash; `pr` → the PR's head
 */
export function refForView(view: EditorView): string | null {
  return frozenCommit(view)?.hash ?? null;
}
