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
