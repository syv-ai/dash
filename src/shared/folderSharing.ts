/** What the folder rule reads of an in-place task (one outside a worktree). */
export interface InPlaceTask {
  id: string;
  path: string;
  /** '' for a task with no branch: a plain folder's, or a repository's with no commits yet. */
  branch: string;
  useWorktree: boolean;
  archivedAt?: string | null;
}

/**
 * Whether two in-place tasks may run in one folder at once. A task on a
 * branch checks that branch out in the folder, so it needs the folder to
 * itself: git refuses one branch in two worktrees, and two tasks switching
 * branches under each other would clobber their work. Tasks with no branch
 * (a plain folder's) switch nothing, so any number share it; their edits can
 * still collide, which the new-task dialog and the sidebar say.
 */
export function canShareFolder(a: Pick<InPlaceTask, 'branch'>, b: Pick<InPlaceTask, 'branch'>) {
  return !a.branch && !b.branch;
}

/** The other active in-place tasks working in `task`'s folder. */
export function folderSharers<T extends InPlaceTask>(
  task: Pick<InPlaceTask, 'id' | 'path' | 'useWorktree'>,
  tasks: readonly T[],
): T[] {
  if (task.useWorktree) return [];
  return tasks.filter(
    (t) => t.id !== task.id && !t.useWorktree && !t.archivedAt && t.path === task.path,
  );
}
