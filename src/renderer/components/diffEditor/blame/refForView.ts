import type { EditorView } from '../types';

/**
 * The git ref to blame against for a view's *modified* side:
 *  - `working` / `branch` → the working file on disk (no rev → `null`, which the
 *    IPC turns into a plain `git blame` that includes uncommitted lines)
 *  - `commit` → that commit's hash
 */
export function refForView(view: EditorView): string | null {
  return view.kind === 'commit' ? view.hash : null;
}
