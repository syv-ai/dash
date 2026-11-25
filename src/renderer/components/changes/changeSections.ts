/*
 * The working tree's changes as Files shows them, pure: the staged and
 * unstaged sections (its changes alone), one change per path (all files),
 * which row reads as the editor's file, where a stage tick stands and what
 * a row's hover actions may do.
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

/** One change per path, for a tree that lists each file once (all
 *  files): the unstaged one where a file is partly staged, so its letter,
 *  stats and discard are the working tree's. */
export function oneChangePerPath(files: readonly FileChange[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const f of files) if (!f.staged || !byPath.has(f.path)) byPath.set(f.path, f);
  return [...byPath.values()];
}

/** Where `paths` stand in the index: every change staged (true), none
 *  (false), or some ('mixed'; a partly staged file is). A tick on it stages
 *  unless it is true. */
export function stagedState(
  files: readonly FileChange[],
  paths: readonly string[],
): boolean | 'mixed' {
  const wanted = new Set(paths);
  let staged = 0;
  let unstaged = 0;
  for (const f of files) {
    if (!wanted.has(f.path)) continue;
    if (f.staged) staged++;
    else unstaged++;
  }
  return unstaged === 0 ? staged > 0 : staged === 0 ? false : 'mixed';
}

/** The section a file opened from Files' changes shows in the editor: the staged
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
 *  deletion, nor an ignored file listed by all files), or .gitignore an
 *  untracked file. */
export function fileActions(change: FileChange) {
  return {
    canDiscard: !change.staged && change.status !== 'deleted' && change.status !== 'ignored',
    canIgnore: change.status === 'untracked',
  };
}
