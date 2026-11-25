/*
 * Normal mode's Files scope ("Show filetree" off or on). The user's pick is kept
 * per task in localStorage (`dash:files-scope:<task id>`, renderer-only like
 * the editor's tabs); until one, Files follows `defaultFilesScope`.
 */

/** What Files lists: the working tree's changes, or every file with them. */
export type FilesScope = 'changed' | 'all';

/** Files' scope until the user picks one: the changes when there are any,
 *  else the whole repo. Null while the task's status loads. */
export function defaultFilesScope(changeCount: number | null): FilesScope | null {
  if (changeCount === null) return null;
  return changeCount > 0 ? 'changed' : 'all';
}

const keyFor = (taskId: string) => `dash:files-scope:${taskId}`;

/** A stored scope, or null for none (or one this build doesn't know). */
export function parseFilesScope(raw: string | null): FilesScope | null {
  return raw === 'changed' || raw === 'all' ? raw : null;
}

export function loadFilesScope(taskId: string): FilesScope | null {
  try {
    return parseFilesScope(localStorage.getItem(keyFor(taskId)));
  } catch {
    return null;
  }
}

export function saveFilesScope(taskId: string, scope: FilesScope): void {
  try {
    localStorage.setItem(keyFor(taskId), scope);
  } catch {
    // Storage full or unavailable: the default serves next time.
  }
}
