import { parsePrScope, prScope } from '../../../../shared/prScope';
import { needsAttention } from '../../../../shared/diffComments';
import type { DiffCommentKind } from '../../../../shared/types';
import type { EditorView } from '../types';

/** The content-identity a comment is anchored to.
 *
 *  `working` views render the live working file as the modified side: their
 *  comments share the `'live'` scope (index or HEAD). A `commit` view renders
 *  frozen content where that line means something else, so its comments are
 *  scoped to the commit hash and stay there; a PR's to the PR. */
export function commentScope(view: EditorView): string {
  if (view.kind === 'pr') return prScope(view.provider, view.number);
  return view.kind === 'commit' ? `commit:${view.hash}` : 'live';
}

/** The 7-char short hash for a `commit:<hash>` scope, else null. */
export function commitShortHash(scope: string): string | null {
  return scope.startsWith('commit:') ? scope.slice(7, 14) : null;
}

/** Human label for a scope: 'Working tree' for the shared live diff, or
 *  'Commit <short>' for a frozen commit. */
export function scopeLabel(scope: string): string {
  const pr = parsePrScope(scope);
  if (pr) return `PR #${pr.number}`;
  const short = commitShortHash(scope);
  return short ? `Commit ${short}` : 'Working tree';
}

/** Total notes and comments needing attention per scope across all files —
 *  feeds the commits-drawer per-view count badges. */
export function commentCountsByScope<
  T extends { viewScope: string; sent?: boolean; kind?: DiffCommentKind },
>(byFile: Record<string, T[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of Object.values(byFile)) {
    for (const c of list) {
      if (!needsAttention(c)) continue;
      counts.set(c.viewScope, (counts.get(c.viewScope) ?? 0) + 1);
    }
  }
  return counts;
}
