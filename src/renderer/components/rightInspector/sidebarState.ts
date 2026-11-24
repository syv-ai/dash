/*
 * The task sidebar's states (see CLAUDE.md): collapsed (not shown; only the
 * Hide control or ⌘⌥B), narrow (one column, no editor pane) and expanded
 * (editor panes beside the tree or list). Opening a file expands it; these
 * decide what the view switch, and the working tree's changes, do to it.
 *
 * Expanded on Changes with nothing changed, the editor would show files no
 * change names, so an empty Changes is always narrow: it says so there ("No
 * changes", ahead and behind). Changes appearing later don't expand it
 * again; opening a file does.
 *
 * `changeCount` is the working tree's, or null until its status has loaded
 * (and for a branch or PR view, whose Changes aren't the working tree's).
 */

/** The view switch's views: the changes, the whole repo, the commits. */
export type CodeSegment = 'changes' | 'files' | 'history';

/** What picking a view does to the sidebar. */
export type SegmentPick =
  /** Go narrow, the editor kept out of sight (on the picked view). */
  | 'narrow'
  /** Show the picked view; while expanded, unfold a folded tree column. */
  | 'select'
  /** Nothing: re-picking the view a narrow sidebar shows. */
  | 'none';

/**
 * Re-picking the view an expanded sidebar shows goes narrow; re-picking the
 * narrow one does nothing; never collapses. Another view keeps the state,
 * except an empty Changes, which goes narrow.
 */
export function pickSegment({
  current,
  next,
  expanded,
  changeCount,
}: {
  /** What shows now: a view, or the details (any view picked from them shows). */
  current: CodeSegment | 'details';
  next: CodeSegment;
  expanded: boolean;
  changeCount: number | null;
}): SegmentPick {
  if (next === current) return expanded ? 'narrow' : 'none';
  return expanded && next === 'changes' && changeCount === 0 ? 'narrow' : 'select';
}

/**
 * What the working tree's change count moving from `before` to `now` does
 * while Changes shows expanded: emptying (a commit, say) goes narrow; loading
 * empty (a task switched back to) shows Files instead, as opening a file
 * there would.
 */
export function onChangeCount({
  segment,
  expanded,
  before,
  now,
}: {
  segment: CodeSegment | 'details';
  expanded: boolean;
  before: number | null;
  now: number | null;
}): 'narrow' | 'files' | null {
  if (!expanded || segment !== 'changes' || now !== 0 || before === 0) return null;
  return before === null ? 'files' : 'narrow';
}

/** The view to show as the sidebar expands (a file opened): an empty
 *  Changes gives way to Files, the tree the file is in. */
export function segmentOnExpand<S extends CodeSegment | 'details'>(
  segment: S,
  changeCount: number | null,
): S | 'files' {
  return segment === 'changes' && changeCount === 0 ? 'files' : segment;
}
