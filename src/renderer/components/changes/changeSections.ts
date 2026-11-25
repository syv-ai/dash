/*
 * Changes as the file tree shows them, pure: the staged and unstaged
 * sections, which row reads as the editor's file, and what a row's hover
 * actions may do.
 */
import type { FileChange } from '../../../shared/types';
import {
  buildTree,
  subtreeChanges,
  type TreeFolder,
  type TreeSection,
  type TreeSelection,
} from '../fileTree/model';
import type { EditorView } from '../diffEditor/types';

export type ChangeSectionId = 'staged' | 'unstaged';

/** Staged changes, then unstaged ones, each headed with its count; a
 *  section with nothing in it is left out. */
export function changeSections(files: readonly FileChange[]): TreeSection[] {
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged);
  const sections: TreeSection[] = [];
  if (staged.length > 0) {
    sections.push({ id: 'staged', label: `Staged · ${staged.length}`, tree: buildTree(staged) });
  }
  if (unstaged.length > 0) {
    sections.push({
      id: 'unstaged',
      label: `Unstaged · ${unstaged.length}`,
      tree: buildTree(unstaged),
    });
  }
  return sections;
}

/** The section a file opened from Changes shows in the editor: the staged
 *  diff is the index view, the unstaged one the working tree's. */
export const sectionOfView = (view: EditorView): ChangeSectionId | null =>
  view.kind !== 'working' ? null : view.ref === 'index' ? 'staged' : 'unstaged';

/** The row that reads as the editor's file: in the section its view shows
 *  (the staged diff, or the working tree's), or else wherever it is listed. */
export function changeSelection(
  path: string | null,
  view: EditorView,
  files: readonly FileChange[],
): TreeSelection | null {
  if (!path) return null;
  const listed = files.filter((f) => f.path === path);
  if (listed.length === 0) return null;
  const want = sectionOfView(view);
  const hit = listed.find((f) => (f.staged ? 'staged' : 'unstaged') === want) ?? listed[0]!;
  return { path, section: hit.staged ? 'staged' : 'unstaged' };
}

/** The view a change opens in: staged against HEAD, or the working tree. */
export const viewOfSection = (section: string): Extract<EditorView, { kind: 'working' }> => ({
  kind: 'working',
  ref: section === 'staged' ? 'index' : 'HEAD',
});

/** What a folder's hover actions may do with the changes beneath it:
 *  discard its unstaged ones (not deletions), or .gitignore it when every
 *  file in it is untracked (ignoring tracked files with it is rarely meant). */
export function folderActions(folder: TreeFolder) {
  const changes = subtreeChanges(folder);
  const discardable = changes.filter((f) => !f.staged && f.status !== 'deleted').map((f) => f.path);
  const canIgnore = changes.length > 0 && changes.every((f) => f.status === 'untracked');
  return { discardable, canIgnore };
}

/** What a file's hover actions may do: discard an unstaged change (not a
 *  deletion), or .gitignore an untracked file. */
export function fileActions(change: FileChange) {
  return {
    canDiscard: !change.staged && change.status !== 'deleted',
    canIgnore: change.status === 'untracked',
  };
}
