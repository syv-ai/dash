/*
 * A tree's keyboard model, pure: what a key does on a row of any tree drawn
 * as one flat list of rows (`ui/Tree`): the file trees, the left sidebar's
 * projects and tasks. A tree maps its own rows onto `TreeNode`s.
 */

/** A row as the keyboard sees it. */
export interface TreeNode {
  key: string;
  /** Its level, 0 at the root. A row outside the levels (a section's
   *  heading) is -1: stepping out never passes it. */
  depth: number;
  /** A branch's state, open or closed; undefined for a leaf. */
  open?: boolean;
  /** The arrow keys land on it: items do; headings, notes and gaps don't. */
  focusable: boolean;
}

/** What a key does on the focused row (an index into the rows): focus
 *  another, or open or close a branch. Null: not the tree's key. */
export type TreeKeyAction = { focus: number } | { toggle: number } | null;

const isBranch = (row: TreeNode | undefined) => row?.open !== undefined;

/** Arrow keys walk the focusable rows, Home and End jump to the ends; Right
 *  opens a branch (then steps in), Left closes it (or steps out to the
 *  branch holding the row). */
export function treeKey(rows: readonly TreeNode[], index: number, key: string): TreeKeyAction {
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (rows[i]!.focusable) return i;
    return null;
  };
  const to = (i: number | null) => (i === null ? null : { focus: i });
  const row = rows[index];
  switch (key) {
    case 'ArrowDown':
      return to(step(index, 1));
    case 'ArrowUp':
      return to(step(index, -1));
    case 'Home':
      return to(step(-1, 1));
    case 'End':
      return to(step(rows.length, -1));
    case 'ArrowRight':
      if (!isBranch(row)) return null;
      return row!.open ? to(step(index, 1)) : { toggle: index };
    case 'ArrowLeft': {
      if (!row?.focusable) return null;
      if (row.open) return { toggle: index };
      // The first row above at a shallower level holds it, if it's a branch.
      for (let i = index - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.depth >= row.depth) continue;
        return isBranch(r) && r.focusable ? { focus: i } : null;
      }
      return null;
    }
    default:
      return null;
  }
}

/** The one row Tab lands on: the last focused (if still shown), else the
 *  selected one, else the first focusable. */
export function tabStopKey(
  rows: readonly TreeNode[],
  focusKey: string | null,
  selectedIndex: number,
): string | undefined {
  if (focusKey !== null && rows.some((r) => r.key === focusKey)) return focusKey;
  return rows[selectedIndex]?.key ?? rows.find((r) => r.focusable)?.key;
}
