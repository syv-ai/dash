import { parsePrScope, prScope } from '../../../../shared/prScope';
import { isPrComment, needsAttention } from '../../../../shared/diffComments';
import type { DiffCommentKind } from '../../../../shared/types';
import type { EditorView } from '../types';

/** The content-identity a comment is anchored to.
 *
 *  `working` and `branch` views both render the live working file as the
 *  modified side (only the base/original side differs), so a comment sits on
 *  the same line in both — they share the `'live'` scope and their comments are
 *  shown (and live-tracked) interchangeably. A `commit` view renders frozen
 *  content where that line means something else, so its comments are scoped to
 *  the commit hash and stay there. */
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

/** Keep only the comments belonging to `scope`, dropping now-empty files.
 *  Used to scope the comments menu / prompt to the view currently open. */
export function filterCommentsByScope<T extends { viewScope: string }>(
  byFile: Record<string, T[]>,
  scope: string,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [path, list] of Object.entries(byFile)) {
    const kept = list.filter((c) => c.viewScope === scope);
    if (kept.length > 0) out[path] = kept;
  }
  return out;
}

/** Notes only: no PR review comments. Those belong to their PR view's
 *  widget, where they're submitted, not to the task's comments menu. */
export function withoutPrComments<T extends { kind?: DiffCommentKind }>(
  byFile: Record<string, T[]>,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [path, list] of Object.entries(byFile)) {
    const kept = list.filter((c) => !isPrComment(c));
    if (kept.length > 0) out[path] = kept;
  }
  return out;
}

/** Group comments by file, keeping each file's order: `first`'s file first,
 *  then by path. */
export function groupByFile<T extends { filePath: string }>(
  comments: readonly T[],
  first?: string,
): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const c of comments) {
    const at = out.get(c.filePath);
    if (at) at.push(c);
    else out.set(c.filePath, [c]);
  }
  return [...out.entries()].sort(([a], [b]) => {
    if (a === first) return -1;
    if (b === first) return 1;
    return a.localeCompare(b);
  });
}
