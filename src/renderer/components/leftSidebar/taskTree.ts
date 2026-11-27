/*
 * The Tasks view as the shared tree's rows (`ui/Tree`), pure: favourites at
 * the top (no heading: their always-shown star says it, T13), the live
 * tasks, then "Sleeping tasks", a branch holding the sleeping ones.
 */
import type { TreeNode } from '../ui/treeNav';
import type { TaskGroups, TaskStateRow } from './taskStates';

export type TaskTreeRow = TreeNode &
  (
    | { kind: 'task'; row: TaskStateRow }
    /** Room between groups. */
    | { kind: 'gap' }
    /** "Sleeping tasks": a branch. */
    | { kind: 'sleeping'; count: number }
  );

const taskRow = (row: TaskStateRow, depth = 0): TaskTreeRow => ({
  kind: 'task',
  key: row.task.id,
  depth,
  focusable: true,
  row,
});

/** The rows on show: the favourites run straight into the live tasks (their
 *  star marks them), a gap between the other groups; the sleeping tasks only
 *  while `sleepingOpen`. */
export function taskTreeRows(groups: TaskGroups, sleepingOpen: boolean): TaskTreeRow[] {
  const rows: TaskTreeRow[] = [];
  const favorites = groups.favorites.length;
  // A gap only after a non-favourite group, or before "Sleeping tasks".
  const gap = (key: string, afterFavorites = false) => {
    if (rows.length > (afterFavorites ? 0 : favorites)) {
      rows.push({ kind: 'gap', key, depth: 0, focusable: false });
    }
  };
  rows.push(...groups.favorites.map((r) => taskRow(r)));
  if (groups.news.length > 0) {
    gap('g:news');
    rows.push(...groups.news.map((r) => taskRow(r)));
  }
  if (groups.resting.length > 0) {
    gap('g:resting');
    rows.push(...groups.resting.map((r) => taskRow(r)));
  }
  if (groups.sleeping.length > 0) {
    gap('g:sleeping', true);
    rows.push({
      kind: 'sleeping',
      key: 'sleeping',
      depth: 0,
      open: sleepingOpen,
      focusable: true,
      count: groups.sleeping.length,
    });
    if (sleepingOpen) rows.push(...groups.sleeping.map((r) => taskRow(r, 1)));
  }
  return rows;
}
