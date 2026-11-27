import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { LineStats } from '../ui/LineStats';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorView } from '../diffEditor/types';
import type { FileChange, RepoListing } from '../../../shared/types';
import { FilesTopRow } from './FilesTopRow';
import { FileTree } from './FileTree';
import { useTreeVersion } from './useTreeVersion';
import {
  buildTree,
  withViewed,
  type FileBadges,
  type FolderTally,
  type ItemRow,
  type TreeSection,
} from './model';

/** A PR's viewed marks: a changed file read through is quiet, with a check
 *  beside its counts; hovering (or Space) marks it viewed or not; the header
 *  tallies them (D270). */
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
  /** Review mode's viewed marks: they take the rows' hover action and Space. */
  viewed?: ViewedColumn;
  /** A row's hover actions (Files' stage and discard); absent: copy its path. */
  actions?: (row: ItemRow) => React.ReactNode;
  /** A row's Space action (Files' stage); see `FileTree`. */
  spaceAction?: (row: ItemRow) => (() => void) | null;
  /** A control at the header's end (review Files' "All files"): the header
   *  is then the pane's top row. */
  headerAction?: React.ReactNode;
  /** Draws its tally; false: the host's top row shows it (Files, D269). */
  tally?: boolean;
}

const NO_DIRS: readonly string[] = [];
const NO_LISTING: RepoListing = { files: [], dirs: [] };

/**
 * A view's files as one tree: its changes, or the whole repo with them
 * (Files on all files, a PR's files), under its
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

  // "All files" means every local file, gitignored ones included, so a
  // local-only config or scratch file can be reached. Ignored files are a
  // working-tree concept (a commit's tree can't contain them); git collapses
  // fully ignored folders to one entry (quiet, read when opened), which keeps
  // `node_modules/` from flooding the tree.
  const showIgnored = git && !changedOnly && view.kind === 'working';
  // The disk changed under the tree: its ignored files and open lazy folders
  // read again.
  const treeVersion = useTreeVersion(cwd, !changedOnly && view.kind === 'working');
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
  }, [showIgnored, cwd, treeVersion]);

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
  const badges = useMemo(
    () => (viewed ? withViewed(badgeCounts, changedFiles, viewed.paths) : badgeCounts),
    [viewed, badgeCounts, changedFiles],
  );
  // Review: a changed file's hover action and Space mark it viewed or not.
  const viewedOf = (row: ItemRow) =>
    viewed && row.kind === 'file' && row.file.change ? row.file.path : null;

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
          listingVersion={treeVersion}
          selected={selected}
          onOpenFile={(row, opts) => onOpenFile(row.file.path, opts)}
          canOpenToSide={canOpenToSide}
          badges={badges}
          quiet={viewed?.paths}
          actions={
            viewed
              ? (row) => {
                  const path = viewedOf(row);
                  return path === null ? null : <ViewedAction path={path} viewed={viewed} />;
                }
              : actions
          }
          spaceAction={
            viewed
              ? (row) => {
                  const path = viewedOf(row);
                  return path === null
                    ? null
                    : () => viewed.onToggle(path, !viewed.paths.has(path));
                }
              : spaceAction
          }
          gapAbove={(changed === 0 || !tally) && !headerAction}
        />
      )}
    </div>
  );
}

/** A tree's tally ("7 changed · 2 viewed +580 −10"); with a control at its
 *  end (review Files' "All files" switch), as the pane's divided top row.
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

/** A changed file's hover action: mark it viewed, or not. */
function ViewedAction({ path, viewed }: { path: string; viewed: ViewedColumn }) {
  const on = viewed.paths.has(path);
  const Icon = on ? EyeOff : Eye;
  return (
    <IconButton
      title={on ? 'Mark unviewed' : 'Mark viewed'}
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        viewed.onToggle(path, !on);
      }}
    >
      <Icon size={14} strokeWidth={1.8} />
    </IconButton>
  );
}

function TreePlaceholder({ children }: { children: React.ReactNode }) {
  return <div className="type-caption px-3 py-2">{children}</div>;
}
