/*
 * The task sidebar's two widths, in % of the window: narrow (one column)
 * and expanded (the editor beside it). It is one panel resized between them,
 * so the shell layout persists whichever is showing; this keeps the other.
 */

export interface InspectorWidths {
  narrow: number;
  expanded: number;
}

const KEY = 'dash:inspector-widths';
const DEFAULTS: InspectorWidths = { narrow: 26, expanded: 50 };

/** As stored: the expanded width keeps its first name, `wide`; `list` and
 *  `reviewList` are the expanded list column's, per mode. */
interface Stored {
  narrow?: unknown;
  wide?: unknown;
  list?: unknown;
  reviewList?: unknown;
}

function valid(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100;
}

function readStored(): Stored {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return saved && typeof saved === 'object' ? (saved as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(patch: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readStored(), ...patch }));
  } catch {
    // Storage full or unavailable: the default width serves next time.
  }
}

export function loadInspectorWidths(): InspectorWidths {
  const saved = readStored();
  return {
    narrow: valid(saved.narrow) ? saved.narrow : DEFAULTS.narrow,
    expanded: valid(saved.wide) ? saved.wide : DEFAULTS.expanded,
  };
}

/** Remember one of the widths, keeping the other. */
export function saveInspectorWidth(which: keyof InspectorWidths, pct: number): void {
  if (!valid(pct)) return;
  writeStored(which === 'narrow' ? { narrow: pct } : { wide: pct });
}

/*
 * The expanded sidebar's list column, in % of the sidebar: one width per
 * mode, since review mode's column (the PR's overview, files and comments)
 * reads better wider than the tree. A width the user drags is kept for that
 * mode and never set for them; double-clicking the divider goes back to the
 * mode's default.
 */

export type ListMode = 'normal' | 'review';

/** Each mode's default list column width (%). */
export const LIST_DEFAULTS: Record<ListMode, number> = { normal: 30, review: 45 };

/** Where the normal mode's column was kept before it had a mode: the panel
 *  library's own layout for the split. */
const LEGACY_LIST_KEY = 'react-resizable-panels:task-sidebar-columns:list:main';

/** A mode's list column width (%) from what is stored: its own, else (normal
 *  mode) the library's legacy layout, else the mode's default. */
export function listWidthFrom(mode: ListMode, stored: Stored, legacy: unknown): number {
  const own = mode === 'review' ? stored.reviewList : stored.list;
  if (valid(own)) return own;
  const old = legacy && typeof legacy === 'object' ? (legacy as { list?: unknown }).list : null;
  if (mode === 'normal' && valid(old)) return old;
  return LIST_DEFAULTS[mode];
}

export function loadListWidth(mode: ListMode): number {
  let legacy: unknown = null;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_LIST_KEY) ?? 'null');
  } catch {
    // Unreadable: the default serves.
  }
  return listWidthFrom(mode, readStored(), legacy);
}

export function saveListWidth(mode: ListMode, pct: number): void {
  if (!valid(pct)) return;
  writeStored(mode === 'review' ? { reviewList: pct } : { list: pct });
}

/**
 * The task sidebar's width (%) once the left sidebar goes from `leftBefore`
 * to `leftAfter`, so the centre keeps its width: the room the left one
 * frees goes to the task sidebar, and the room it takes comes from it,
 * within the task sidebar's bounds (the centre absorbs what's left over).
 */
export function handOffWidth({
  inspector,
  leftBefore,
  leftAfter,
  min,
  max,
}: {
  inspector: number;
  leftBefore: number;
  leftAfter: number;
  min: number;
  max: number;
}): number {
  return Math.min(max, Math.max(min, inspector + leftBefore - leftAfter));
}

/*
 * Collapsing the task sidebar keeps the editor (and its unsaved edits)
 * mounted out of sight; going narrow or expanded is a separate act. These
 * two decide the panel's width when one happens while the other holds.
 */

/**
 * The width (%) to ease to as the sidebar goes `expanded` or narrow, or null
 * to leave the panel be: going narrow behind a collapsed sidebar keeps it
 * collapsed (it shows at the narrow width later), while expanding always
 * shows it.
 */
export function widthOnExpandedToggle({
  expanded,
  collapsed,
  widths,
}: {
  expanded: boolean;
  collapsed: boolean;
  widths: InspectorWidths;
}): number | null {
  if (collapsed && !expanded) return null;
  return expanded ? widths.expanded : widths.narrow;
}

/**
 * The width (%) to take as a collapsed sidebar shows again, or null to keep
 * the one the panel came back at (the width it collapsed from). If it went
 * narrow or expanded meanwhile, that width belongs to the other state: take
 * this state's remembered one. A narrow sidebar never comes back wider than
 * `narrowMax` (a layout persisted expanded).
 */
export function widthOnShow({
  expandedAtCollapse,
  expanded,
  restored,
  widths,
  narrowMax,
}: {
  expandedAtCollapse: boolean;
  expanded: boolean;
  restored: number;
  widths: InspectorWidths;
  narrowMax: number;
}): number | null {
  if (expandedAtCollapse !== expanded) return expanded ? widths.expanded : widths.narrow;
  if (!expanded && restored > narrowMax) return widths.narrow;
  return null;
}

/*
 * Narrow ⇄ expanded as one planned motion (D258): the list column keeps its
 * width throughout, so only the panel's edge moves and the editor fades in
 * or out beside the list. Expanding also collapses the left sidebar, its
 * room going to the editor; going narrow gives it back.
 */

/** The task sidebar's padding at its end (px): the narrow column is the
 *  panel less it, and the split's list panel is the column plus the same
 *  gutter before the editor. */
export const SIDEBAR_GUTTER_PX = 8;

/**
 * Where expanding eases to: the remembered expanded width plus the room the
 * left sidebar frees (`freedPx`), never so narrow that the list (`listPx`,
 * the split's list panel, as wide as the narrow panel) passes `listMaxPct`
 * of the split, nor wider than `maxPx`. `listPct`: the list's share of the
 * split there, so it keeps `listPx` (less only where `maxPx` forbids).
 */
export function planExpand({
  groupPx,
  listPx,
  expandedPct,
  freedPx,
  maxPx,
  listMaxPct,
}: {
  groupPx: number;
  listPx: number;
  expandedPct: number;
  freedPx: number;
  maxPx: number;
  listMaxPct: number;
}): { panelPx: number; panelPct: number; listPct: number } {
  const want = (expandedPct / 100) * groupPx + freedPx;
  const floor = (listPx * 100) / listMaxPct + SIDEBAR_GUTTER_PX;
  const panelPx = Math.round(Math.min(maxPx, Math.max(want, floor)));
  const listPct = Math.min(listMaxPct, (listPx / (panelPx - SIDEBAR_GUTTER_PX)) * 100);
  return { panelPx, panelPct: (panelPx / groupPx) * 100, listPct };
}

/** Where going narrow eases to (%): as wide as the split's list panel
 *  (`listPx`), so the column keeps its width, within `min`–`max`. */
export function narrowFromList({
  groupPx,
  listPx,
  min,
  max,
}: {
  groupPx: number;
  listPx: number;
  min: number;
  max: number;
}): number {
  return Math.min(max, Math.max(min, (listPx / groupPx) * 100));
}
