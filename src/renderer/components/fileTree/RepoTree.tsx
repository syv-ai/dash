import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Checkbox } from '../ui/Checkbox';
import { LineStats } from '../ui/LineStats';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorView } from '../diffEditor/types';
import type { FileChange, RepoListing } from '../../../shared/types';
import { FilesTopRow } from './FilesTopRow';
import { FileTree } from './FileTree';
import {
  buildTree,
  type FileBadges,
  type FolderTally,
  type ItemRow,
  type TreeSection,
} from './model';

/** A PR's viewed marks: a tick in the tree's left-edge column on each changed
 *  file read through (its name quiet), and the tally in the header. */
export interface ViewedColumn {
  paths: ReadonlySet<string>;
  /** Mark `path` viewed, or not. */
  onToggle: (path: string, viewed: boolean) => void;
}

interface RepoTreeProps {
  /** Repo root — needed to lazily list gitignored files under "show all files". */
  cwd: string;
  /** `cwd` is a task's worktree. Otherwise it is plain files: no changes to
   *  filter on, no ignored files. */
  git: boolean;
  view: EditorView;
  /** All file paths in the current view's source (whole repo, sorted). */
  allPaths: readonly string[];
  /** Directories the listing names as one entry (symlinked ones): shown as
   *  folders, listed when opened. */
  repoDirs?: readonly string[];
  /** The paths that have a diff in this view, with status and line stats. */
  changedFiles: readonly FileChange[];
  /** List only the changed files (and their folders), not the whole repo. */
  changedOnly: boolean;
  filesLoading: boolean;
  /** The file showing in the focused editor group. */
  selectedPath: string;
  /** Open a file in the focused group (a click: as its preview), or
   *  `toSide` in the other one. */
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  /** The editor shows one pane: a file's menu offers "Open in new pane". */
  canOpenToSide: boolean;
  badgeCounts: ReadonlyMap<string, FileBadges>;
  /** Review mode's viewed marks (their ticks fill the left-edge column). */
  viewed?: ViewedColumn;
  /** A row's hover actions (Files' stage and discard); absent: copy its path. */
  actions?: (row: ItemRow) => React.ReactNode;
  /** A row's Space action (Files' stage); see `FileTree`. */
  spaceAction?: (row: ItemRow) => (() => void) | null;
  /** A control at the header's end (review Files' "Show filetree"): the header
   *  is then the pane's top row. */
  headerAction?: React.ReactNode;
  /** Draws its tally; false: the host's top row shows it (Files, D269). */
  tally?: boolean;
}

const NO_DIRS: readonly string[] = [];
const NO_LISTING: RepoListing = { files: [], dirs: [] };

/**
 * A view's files as one tree: its changes, or the whole repo with them
 * (Files on all files, the editor modal, a PR's files), under its
 * `TreeHeader`.
 */
export function RepoTree({
  cwd,
  git,
  view,
  allPaths,
  repoDirs = NO_DIRS,
  changedFiles,
  changedOnly: changedOnlyProp,
  filesLoading,
  selectedPath,
  onOpenFile,
  canOpenToSide,
  badgeCounts,
  viewed,
  actions,
  spaceAction,
  headerAction,
  tally = true,
}: RepoTreeProps) {
  // Plain files have no changes to filter on, and nothing git ignores.
  const changedOnly = git && changedOnlyProp;

  // "Show filetree" means every local file, gitignored ones included, so a
  // local-only config or scratch file can be reached. Ignored files are a
  // working-tree concept (a commit's tree can't contain them); git collapses
  // fully ignored folders to one entry (quiet, read when opened), which keeps
  // `node_modules/` from flooding the tree.
  const showIgnored = git && !changedOnly && view.kind === 'working';
  const [ignored, setIgnored] = useState<RepoListing>(NO_LISTING);
  useEffect(() => {
    if (!showIgnored) {
      setIgnored(NO_LISTING);
      return;
    }
    let cancelled = false;
    void window.electronAPI.editorListIgnoredFiles({ cwd }).then((resp) => {
      if (!cancelled) setIgnored(resp.success && resp.data ? resp.data : NO_LISTING);
    });
    return () => {
      cancelled = true;
    };
  }, [showIgnored, cwd]);

  const tree = useMemo(
    () =>
      buildTree(
        changedFiles,
        changedOnly ? undefined : { paths: allPaths, dirs: repoDirs, ignored },
      ),
    [changedOnly, allPaths, changedFiles, ignored, repoDirs],
  );
  const sections = useMemo<TreeSection[]>(() => [{ id: 'files', tree }], [tree]);
  const selected = useMemo(() => (selectedPath ? { path: selectedPath } : null), [selectedPath]);
  const changed = tree.tally.changed;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {tally && <TreeHeader tally={tree.tally} viewed={viewed?.paths.size} action={headerAction} />}
      {filesLoading && allPaths.length === 0 ? (
        <TreePlaceholder>Loading…</TreePlaceholder>
      ) : changedOnly && changed === 0 ? (
        <TreePlaceholder>No changed files</TreePlaceholder>
      ) : (
        <FileTree
          sections={sections}
          cwd={cwd}
          selected={selected}
          onOpenFile={(row, opts) => onOpenFile(row.file.path, opts)}
          canOpenToSide={canOpenToSide}
          badges={badgeCounts}
          quiet={viewed?.paths}
          leading={viewed && ((row) => <ViewedTick row={row} viewed={viewed} />)}
          actions={actions}
          spaceAction={spaceAction}
          gapAbove={(changed === 0 || !tally) && !headerAction}
        />
      )}
    </div>
  );
}

/** A tree's tally ("7 changed · 2 viewed +580 −10"); with a control at its
 *  end (review Files' "Show filetree" switch), as the pane's divided top row.
 *  Nothing with neither. */
export function TreeHeader({
  tally,
  viewed,
  action,
}: {
  tally: FolderTally;
  /** Review mode's viewed count. */
  viewed?: number;
  action?: React.ReactNode;
}) {
  const summary = tally.changed > 0 && <TreeTally tally={tally} viewed={viewed} />;
  if (action) return <FilesTopRow start={summary} end={action} />;
  if (!summary) return null;
  return <div className="type-caption flex h-8 shrink-0 items-center gap-2 px-3">{summary}</div>;
}

/** What a tree's tally says: "7 changed · 2 viewed +580 −10". */
export function TreeTally({ tally, viewed }: { tally: FolderTally; viewed?: number }) {
  return (
    <>
      <span className="tabular-nums">
        {tally.changed} changed
        {viewed !== undefined && ` · ${viewed} viewed`}
      </span>
      <LineStats add={tally.add + tally.untrackedAdd} del={tally.del} />
    </>
  );
}

/** The viewed tick, only on a file the view changes. */
function ViewedTick({ row, viewed }: { row: ItemRow; viewed: ViewedColumn }) {
  if (row.kind !== 'file' || !row.file.change) return null;
  const path = row.file.path;
  const on = viewed.paths.has(path);
  return (
    <Checkbox
      checked={on}
      aria-label={on ? 'Mark not viewed' : 'Mark viewed'}
      onChange={() => viewed.onToggle(path, !on)}
    />
  );
}

function TreePlaceholder({ children }: { children: React.ReactNode }) {
  return <div className="type-caption px-3 py-2">{children}</div>;
}
