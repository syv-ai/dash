import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, TreeHeading, type TreeHandle } from '../ui/Tree';
import { useEditorTabs } from '../../stores/editorTabsStore';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import {
  flattenTree,
  folderRowIndex,
  isSelected,
  openKey,
  revealKeys,
  treeColumns,
  treeNode,
  type FileBadges,
  type ItemRow,
  type Listing,
  type TreeRow,
  type TreeSection,
  type TreeSelection,
} from './model';
import { TreeItem, TreeNote } from './TreeItem';

export type FileRow = Extract<TreeRow, { kind: 'file' }>;

export interface FileTreeProps {
  /** The trees it lists, one after another: one for all files, Staged and
   *  Unstaged for Files' changes (each headed by its `label`). */
  sections: readonly TreeSection[];
  /** The folder the paths are in: for the menus, and lazy folders' reads. */
  cwd: string;
  /** Moves when the disk changed under `cwd`: lazy folders read again. */
  listingVersion?: number;
  /** The row that reads as current (the editor's file). */
  selected: TreeSelection | null;
  /** Open a file: a click previews it (`preview`), ⌥-click opens it beside
   *  (`toSide`); a double-click or the menu's Open keeps it (no options). */
  onOpenFile: (row: FileRow, opts?: OpenOptions) => void;
  /** The menu offers "Open in new pane". */
  canOpenToSide: boolean;
  badges?: ReadonlyMap<string, FileBadges>;
  /** Files named quietly (a PR's viewed ones). */
  quiet?: ReadonlySet<string>;
  /** A row's hover actions; null or absent: copy its relative path. */
  actions?: (row: ItemRow) => React.ReactNode;
  /** A row's Space action (Files: stage or unstage); null or absent: Space
   *  opens it, like Enter. */
  spaceAction?: (row: ItemRow) => (() => void) | null;
  /** 8px above the first row, when nothing heads the tree. */
  gapAbove?: boolean;
}

/** Rows ListRow `sm` draws; a section header a little shorter. */
const estimate = (row: TreeRow | undefined) => (row?.kind === 'section' ? 28 : 32);

/**
 * The app's one file tree (Files, a PR's files, the editor modal), on the
 * shared `ui/Tree` (windowing, focus, the arrow keys): its sections' folders
 * (folded) and files, depth first. It owns which folders are open (changed
 * ones and the selection's by default; lazy folders read when opened) and
 * every row's look (`TreeItem`). Trees differ only in what they pass:
 * sections, hover actions, a Space action, badges and quiet paths.
 */
export function FileTree({
  sections,
  cwd,
  listingVersion = 0,
  selected,
  onOpenFile,
  canOpenToSide,
  badges,
  quiet,
  actions,
  spaceAction,
  gapAbove,
}: FileTreeProps) {
  const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(() => new Map());

  const rows = useMemo(
    () => flattenTree(sections, { open, listings, selected }),
    [sections, open, listings, selected],
  );
  const cols = useMemo(() => treeColumns(rows, badges), [rows, badges]);

  const toggle = useCallback((row: Extract<TreeRow, { kind: 'folder' }>) => {
    setOpen((m) => new Map(m).set(openKey(row.section, row.folder.path), !row.open));
  }, []);

  // Lazy folders read when they open, once per folder (per `cwd` and
  // `listingVersion`).
  const requested = useRef(new Set<string>());
  useEffect(() => {
    requested.current = new Set();
    setListings(new Map());
  }, [cwd]);
  // The disk changed: open lazy folders read again (showing what they held
  // until then), closed ones when they next open.
  useEffect(() => {
    requested.current = new Set();
  }, [listingVersion]);
  useEffect(() => {
    for (const row of rows) {
      if (row.kind !== 'folder' || !row.open || !row.folder.lazy) continue;
      const dirPath = row.folder.path;
      if (requested.current.has(dirPath)) continue;
      requested.current.add(dirPath);
      void window.electronAPI.editorListDir({ cwd, dirPath }).then((resp) => {
        const listing: Listing =
          resp.success && resp.data ? resp.data : { error: resp.error ?? 'Could not list folder' };
        setListings((m) => new Map(m).set(dirPath, listing));
      });
    }
  }, [rows, cwd, listingVersion]);

  const treeRef = useRef<TreeHandle>(null);

  // A tab that names a folder asked to show it: open it and the folders
  // holding it, then bring its row into view, focused.
  const expand = useEditorTabs((s) => s.expandFolder);
  const revealing = useRef<string | null>(null);
  useEffect(() => {
    if (!expand) return;
    revealing.current = expand.path;
    setOpen((m) => {
      const next = new Map(m);
      for (const key of revealKeys(sections, expand.path)) next.set(key, true);
      return next;
    });
    // Only on a new request, not as the sections change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expand]);
  useEffect(() => {
    const path = revealing.current;
    if (path === null) return;
    const index = folderRowIndex(rows, path);
    if (index < 0) return;
    revealing.current = null;
    treeRef.current?.focusRow(index);
  });

  return (
    <Tree
      rows={rows}
      nodeOf={treeNode}
      handleRef={treeRef}
      className="min-h-0 flex-1"
      gapAbove={gapAbove}
      isSelected={(row) => isSelected(row, selected)}
      onToggle={(row) => row.kind === 'folder' && toggle(row)}
      estimateSize={estimate}
      renderRow={(row, ctx) => {
        if (row.kind === 'section') return <TreeHeading>{row.label}</TreeHeading>;
        if (row.kind === 'note') return <TreeNote row={row} />;
        const path = row.kind === 'file' ? row.file.path : row.folder.path;
        return (
          <TreeItem
            row={row}
            ctx={ctx}
            cwd={cwd}
            cols={cols}
            quiet={row.kind === 'file' && (row.file.ignored || !!quiet?.has(path))}
            badges={row.kind === 'file' ? badges?.get(path) : undefined}
            actions={actions?.(row) ?? null}
            onSpace={spaceAction?.(row) ?? undefined}
            canOpenToSide={canOpenToSide}
            onActivate={(opts) => (row.kind === 'file' ? onOpenFile(row, opts) : toggle(row))}
          />
        );
      }}
    />
  );
}
