/*
 * The task sidebar's two widths, in % of the window: narrow (the changes
 * list) and wide (a diff open). It is one panel resized between them, so
 * the shell layout persists whichever is showing; this keeps the other.
 */

export interface InspectorWidths {
  narrow: number;
  wide: number;
}

const KEY = 'dash:inspector-widths';
const DEFAULTS: InspectorWidths = { narrow: 26, wide: 50 };

function valid(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100;
}

export function loadInspectorWidths(): InspectorWidths {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<InspectorWidths>;
    return {
      narrow: valid(saved.narrow) ? saved.narrow : DEFAULTS.narrow,
      wide: valid(saved.wide) ? saved.wide : DEFAULTS.wide,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Remember one of the widths, keeping the other. */
export function saveInspectorWidth(which: keyof InspectorWidths, pct: number): void {
  if (!valid(pct)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadInspectorWidths(), [which]: pct }));
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
 * mounted out of sight; the editor opening or closing is a separate act.
 * These two decide the panel's width when one happens while the other
 * holds.
 */

/**
 * The width (%) to ease to as the editor opens (`wide`) or closes, or null
 * to leave the panel be: closing behind a collapsed sidebar keeps it
 * collapsed (it expands to the narrow width later), while opening the
 * editor always shows it.
 */
export function widthOnEditorToggle({
  wide,
  collapsed,
  widths,
}: {
  wide: boolean;
  collapsed: boolean;
  widths: InspectorWidths;
}): number | null {
  if (collapsed && !wide) return null;
  return wide ? widths.wide : widths.narrow;
}

/**
 * The width (%) to take on expanding, or null to keep the one the panel
 * came back at (the width it collapsed from). If the editor opened or
 * closed meanwhile, that width belongs to the other mode: take this mode's
 * remembered one. A narrow sidebar never comes back wider than `narrowMax`
 * (a layout persisted with the editor open).
 */
export function widthOnExpand({
  wideAtCollapse,
  wide,
  restored,
  widths,
  narrowMax,
}: {
  wideAtCollapse: boolean;
  wide: boolean;
  restored: number;
  widths: InspectorWidths;
  narrowMax: number;
}): number | null {
  if (wideAtCollapse !== wide) return wide ? widths.wide : widths.narrow;
  if (!wide && restored > narrowMax) return widths.narrow;
  return null;
}
