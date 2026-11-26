/*
 * The Tasks view as the shared tree's rows (`ui/Tree`), pure.
 */
import type { TreeNode } from '../ui/treeNav';
import { IDLE_LIMIT, visibleIdleRows, type TaskStateList, type TaskStateRow } from './taskStates';

export type TaskTreeRow = TreeNode &
  (
    | { kind: 'task'; row: TaskStateRow }
    /** Room between the rows with news and the ones at rest. */
    | { kind: 'gap' }
    /** More / Less: the at-rest rows past the first few. */
    | { kind: 'more'; expanded: boolean; hidden: number }
  );

const taskRow = (row: TaskStateRow): TaskTreeRow => ({
  kind: 'task',
  key: row.task.id,
  depth: 0,
  focusable: true,
  row,
});

/** The rows on show: the active ones, a gap, the idle ones on show
 *  (`visibleIdleRows`), and More / Less past IDLE_LIMIT. */
export function taskTreeRows(
  list: TaskStateList,
  showAllIdle: boolean,
  selectedTaskId: string | null,
): TaskTreeRow[] {
  const idle = visibleIdleRows(list.idle, showAllIdle, selectedTaskId);
  const rows = list.active.map(taskRow);
  if (rows.length > 0 && idle.length > 0) {
    rows.push({ kind: 'gap', key: 'gap', depth: 0, focusable: false });
  }
  rows.push(...idle.map(taskRow));
  if (list.idle.length > IDLE_LIMIT) {
    rows.push({
      kind: 'more',
      key: 'more',
      depth: 0,
      focusable: true,
      expanded: showAllIdle,
      hidden: list.idle.length - idle.length,
    });
  }
  return rows;
}
