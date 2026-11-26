import { broadcast } from '../utils/broadcast';
import { watchFolder } from '../utils/watchFolder';

/** Quiet time after the last file event before the tree is told: a checkout
 *  or an install is one refresh, not hundreds. */
export const WORKING_TREE_DEBOUNCE_MS = 300;

/**
 * Paths whose churn says nothing the tree needs (cf. VS Code's
 * `files.watcherExclude`): git's own folder (status polls and fetches rewrite
 * it), and what's beneath any `node_modules` (installs) or a task's worktree
 * inside a main checkout (each its own tree; agents write there all the
 * time). Those folders themselves coming or going still count; a lazy folder
 * opened beneath one shows what it held when read.
 */
export function isUnwatchedPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/);
  const modules = parts.indexOf('node_modules');
  return (
    parts[0] === '.git' ||
    (modules >= 0 && modules < parts.length - 1) ||
    (parts[0] === '.claude' && parts[1] === 'worktrees' && parts.length > 3)
  );
}

const watches = new Map<string, { refs: number; close: () => void }>();

/**
 * The all-files tree shows `cwd`'s files: tell it (`editor:treeChanged`) when
 * any file or folder under it is created, deleted or renamed, until it
 * unwatches. Its listing comes from git and the disk, and git's own signals
 * (the index, HEAD) say nothing about untracked or ignored files.
 */
export function watchWorkingTree(cwd: string): void {
  const watch = watches.get(cwd);
  if (watch) {
    watch.refs++;
    return;
  }
  const close = watchFolder(cwd, {
    debounceMs: WORKING_TREE_DEBOUNCE_MS,
    ignore: isUnwatchedPath,
    onChange: () => broadcast('editor:treeChanged', { cwd }),
  });
  watches.set(cwd, { refs: 1, close });
}

export function unwatchWorkingTree(cwd: string): void {
  const watch = watches.get(cwd);
  if (!watch || --watch.refs > 0) return;
  watch.close();
  watches.delete(cwd);
}

/** Close every watch (quit). */
export function stopWorkingTreeWatches(): void {
  for (const watch of watches.values()) watch.close();
  watches.clear();
}
