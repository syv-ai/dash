import { selectActiveTask, useProjects } from '../../stores/projectsStore';
import { useGit } from '../../stores/gitStore';
import { useEditorTabs, type TextRange } from '../../stores/editorTabsStore';

/**
 * Open a file in the active task's editor (opening the editor if it is
 * closed) and, with `range`, reveal and select it there once it shows. The
 * entry point for go-to-definition and links into code.
 *
 * `path` is absolute or relative to the task's worktree. Returns false, doing
 * nothing, when there is no active task or the file is outside its worktree.
 */
export function openFileAt(path: string, range?: TextRange): boolean {
  const task = selectActiveTask(useProjects.getState());
  if (!task) return false;
  const root = task.path.replace(/\/+$/, '');
  let rel = path;
  if (path.startsWith('/')) {
    if (!path.startsWith(`${root}/`)) return false;
    rel = path.slice(root.length + 1);
  }
  if (!rel) return false;

  const tabs = useEditorTabs.getState();
  tabs.load(task.id, true);
  if (range) tabs.openAt(task.id, rel, range);
  else tabs.open(task.id, rel, { preview: true });

  const git = useGit.getState();
  if (git.diffFile?.cwd !== task.path) {
    git.setDiffFile({ cwd: task.path, filePath: '' });
  }
  return true;
}
