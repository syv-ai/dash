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

/** As stored: the expanded width keeps its first name, `wide`. */
interface Stored {
  narrow?: unknown;
  wide?: unknown;
}

function valid(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100;
}

export function loadInspectorWidths(): InspectorWidths {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
    return {
      narrow: valid(saved.narrow) ? saved.narrow : DEFAULTS.narrow,
      expanded: valid(saved.wide) ? saved.wide : DEFAULTS.expanded,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Remember one of the widths, keeping the other. */
export function saveInspectorWidth(which: keyof InspectorWidths, pct: number): void {
  if (!valid(pct)) return;
  const widths = { ...loadInspectorWidths(), [which]: pct };
  const stored: Stored = { narrow: widths.narrow, wide: widths.expanded };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage full or unavailable: the default width serves next time.
  }
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
