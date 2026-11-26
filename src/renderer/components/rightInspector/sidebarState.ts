/*
 * The task sidebar's states (see CLAUDE.md): collapsed (its rail, `rail.ts`;
 * only the Hide control or ⌘⌥B), narrow (one column, no editor pane) and expanded
 * (editor panes beside the tree or list). Opening a file expands it; these
 * decide what the view switch does to it.
 *
 * Normal mode's views are Files, History and Agent (spec Revision 5; Agent,
 * A1: the session's scratchpad and the project's memory, `agentTab`). Files
 * is one tree scoped by its "Show filetree" switch (`filesScope`): the
 * changes (Staged / Unstaged, the commit footer) or the whole repo with them.
 *
 * Review mode (spec Revision 4) has its own views, each scoped to a PR:
 * Overview, Files (the PR's changed files, or all of them at its head),
 * Comments and History, then Agent as in normal mode; the editor shows the
 * PR's view, except a commit picked in History.
 */

import { treeOrder } from '../fileTree/treeOrder';

/** The view switch's views: normal mode's Files, History and Agent; review
 *  mode's Overview, Files, Comments, History and Agent. */
export type CodeSegment = 'overview' | 'files' | 'comments' | 'history' | 'agent';

/** What the sidebar's list shows: a view, or the task's details (an icon
 *  toggle at the view row's end, read least often). */
export type SidebarView = CodeSegment | 'details';

/** What picking a view does to the sidebar. */
export type SegmentPick =
  /** Go narrow, the editor kept out of sight (on the picked view). */
  | 'narrow'
  /** Expand on the narrow view's first file (`firstListedChange` or
   *  `firstTreeFile` by Files' scope, the commit's; in review mode the PR's
   *  first, or the first open thread's at its line). */
  | 'expand'
  /** Show the picked view; while expanded, unfold a folded tree column. */
  | 'select'
  /** Nothing: a single click on the current view, or re-picking a narrow
   *  view with no first file (Files on its changes with none, Comments with
   *  no open thread on the code, Agent, which has no first file of its own). */
  | 'none';

/**
 * Re-picking the current view changes the state only on a double click
 * (`reselect`); a single click on it does nothing. Then: expanded goes
 * narrow; narrow expands on its first file, unless it has none; never
 * collapses. Another view keeps the state.
 */
export function pickSegment({
  current,
  next,
  reselect,
  expanded,
  changesOnly,
  listedChanges,
  openThread,
}: {
  /** The current view was double-clicked (not a single click). */
  reselect: boolean;
  /** What shows now: a view, or the details (any view picked from them shows). */
  current: CodeSegment | 'details';
  next: CodeSegment;
  expanded: boolean;
  /** Files lists the working tree's changes alone (normal mode). */
  changesOnly: boolean;
  /** The working tree's changes, as Files lists them on its changes. */
  listedChanges: number;
  /** Review mode's Comments has an open thread on the code to open at. */
  openThread: boolean;
}): SegmentPick {
  if (next !== current) return 'select';
  if (!reselect) return 'none';
  if (expanded) return 'narrow';
  const empty =
    (next === 'files' && changesOnly && listedChanges === 0) ||
    (next === 'comments' && !openThread) ||
    next === 'agent';
  return empty ? 'none' : 'expand';
}

/* The first file of a tree as it displays (see `fileTree/treeOrder`). */

function first<T>(items: readonly T[], order: (a: T, b: T) => number): T | null {
  let best: T | null = null;
  for (const item of items) if (best === null || order(item, best) < 0) best = item;
  return best;
}

/** The file Files lists first on its changes: its staged section's first, else
 *  its unstaged section's. Null with no changes. */
export function firstListedChange<F extends { path: string; staged: boolean }>(
  files: readonly F[],
): F | null {
  return first(files, (a, b) =>
    a.staged !== b.staged ? (a.staged ? -1 : 1) : treeOrder(a.path, b.path),
  );
}

/** The repo tree's first file at its shallowest level: what Files shows
 *  first on all files, its folders folded. Null for an empty repo. */
export function firstTreeFile(paths: readonly string[]): string | null {
  const depth = (p: string) => p.split('/').length;
  return first(paths, (a, b) => depth(a) - depth(b) || treeOrder(a, b));
}

/** The editor tree's first file with its folders unfolded: what a PR's
 *  changes list first. Null with no files. */
export function firstChangedTreeFile(paths: readonly string[]): string | null {
  return first(paths, treeOrder);
}

/**
 * The view to show as review mode becomes known, starts or ends (each
 * `undefined` until main has said): a task found in review mode, opened or
 * just entered, shows Overview (D118); Overview and Comments are the mode's
 * alone, so ending it on either shows Files.
 */
export function segmentOnMode<S extends CodeSegment | 'details'>({
  segment,
  was,
  now,
}: {
  segment: S;
  was: boolean | undefined;
  now: boolean | undefined;
}): S | 'overview' | 'files' {
  if (now && !was) return 'overview';
  const reviewOnly = segment === 'overview' || segment === 'comments';
  return reviewOnly && !now ? 'files' : segment;
}

/**
 * What picking a view does to the editor's view (D2): leaving History drops
 * the commit it showed, for the PR's view in review mode and the working
 * tree otherwise. Null: the view stays.
 */
export function viewOnSegment({
  reviewing,
  to,
  viewKind,
}: {
  reviewing: boolean;
  to: CodeSegment;
  viewKind: 'working' | 'commit' | 'pr';
}): 'pr' | 'working' | null {
  if (to === 'history' || viewKind !== 'commit') return null;
  return reviewing ? 'pr' : 'working';
}

/**
 * What leaving review mode does to the editor's view, however it ends (✕,
 * main ending it, a jump to a note outside the PR): back to the working
 * tree from the PR's view and from a commit, which in review mode is always
 * one of the PR's (History lists those alone). Null: it stays.
 */
export function viewOnExit(viewKind: 'working' | 'commit' | 'pr'): 'working' | null {
  return viewKind === 'working' ? null : 'working';
}

/** The editor's view, as far as following review mode goes. */
type ViewOfPr =
  | { kind: 'pr'; provider: string; number: number; base: string; head: string }
  | { kind: 'working' | 'commit' };

/**
 * Whether the editor's view must follow review mode: in it, the PR's view at
 * the head its review was last loaded at (a push moves it) — a commit picked
 * in History aside; out of it, never a PR's view, and on the render it ended
 * `viewOnExit`'s rule. 'pr' re-points it at the mode's PR, 'working' returns
 * to the working tree; null: it stays.
 */
export function viewForMode({
  mode,
  ended = false,
  view,
  review,
}: {
  mode: { provider: string; number: number } | null;
  /** Review mode has just ended (it was on, now it is off). */
  ended?: boolean;
  view: ViewOfPr;
  /** The mode's PR's review as last fetched, if it has been. */
  review: { base: string; head: string } | null;
}): 'pr' | 'working' | null {
  if (!mode) return ended ? viewOnExit(view.kind) : view.kind === 'pr' ? 'working' : null;
  if (view.kind === 'commit') return null;
  if (view.kind !== 'pr') return 'pr';
  if (view.provider !== mode.provider || view.number !== mode.number) return 'pr';
  return review && (review.base !== view.base || review.head !== view.head) ? 'pr' : null;
}
