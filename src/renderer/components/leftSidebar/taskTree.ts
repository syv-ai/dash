/*
 * The Tasks view as the shared tree's rows (`ui/Tree`), pure: favourites
 * under their heading, the live tasks, then "Inactive sessions", a branch
 * holding the sleeping ones.
 */
import type { TreeNode } from '../ui/treeNav';
import type { TaskGroups, TaskStateRow } from './taskStates';

export type TaskTreeRow = TreeNode &
  (
    | { kind: 'task'; row: TaskStateRow }
    /** The Favourites group's heading. */
    | { kind: 'heading'; label: string }
    /** Room between groups. */
    | { kind: 'gap' }
    /** "Inactive sessions": the sleeping tasks, a branch. */
    | { kind: 'inactive'; count: number }
  );

const taskRow = (row: TaskStateRow, depth = 0): TaskTreeRow => ({
  kind: 'task',
  key: row.task.id,
  depth,
  focusable: true,
  row,
});

/** The rows on show: each non-empty group, a gap between them; the sleeping
 *  tasks only while `inactiveOpen`. */
export function taskTreeRows(groups: TaskGroups, inactiveOpen: boolean): TaskTreeRow[] {
  const rows: TaskTreeRow[] = [];
  const gap = (key: string) => {
    if (rows.length > 0) rows.push({ kind: 'gap', key, depth: 0, focusable: false });
  };
  if (groups.favorites.length > 0) {
    rows.push({
      kind: 'heading',
      key: 'h:favorites',
      label: 'Favourites',
      depth: -1,
      focusable: false,
    });
    rows.push(...groups.favorites.map((r) => taskRow(r)));
  }
  if (groups.news.length > 0) {
    gap('g:news');
    rows.push(...groups.news.map((r) => taskRow(r)));
  }
  if (groups.resting.length > 0) {
    gap('g:resting');
    rows.push(...groups.resting.map((r) => taskRow(r)));
  }
  if (groups.inactive.length > 0) {
    gap('g:inactive');
    rows.push({
      kind: 'inactive',
      key: 'inactive',
      depth: 0,
      open: inactiveOpen,
      focusable: true,
      count: groups.inactive.length,
    });
    if (inactiveOpen) rows.push(...groups.inactive.map((r) => taskRow(r, 1)));
  }
  return rows;
}
