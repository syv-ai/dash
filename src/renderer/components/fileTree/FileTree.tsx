import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VirtualList, type VirtualListHandle } from '../ui/VirtualList';
import { useEditorTabs } from '../../stores/editorTabsStore';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import {
  flattenTree,
  folderRowIndex,
  isSelected,
  openKey,
  revealKeys,
  treeColumns,
  treeKey,
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
  /** A control in a column at the tree's left edge (review's viewed tick),
   *  straight down the tree whatever the nesting; null leaves a row's cell
   *  empty. Absent: no column, no room kept for it. */
  leading?: (row: ItemRow) => React.ReactNode;
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
 * The app's one file tree (Files, a PR's files, the editor modal):
 * its sections' folders (folded) and files, depth first, windowed so a
 * repo-sized tree stays light. It owns which folders are open (changed ones
 * and the selection's by default; lazy folders read when opened), the
 * selection highlight, the arrow keys and every row's look. Trees differ
 * only in what they pass: sections, a leading control, hover actions, a
 * Space action, badges and quiet paths.
 */
export function FileTree({
  sections,
  cwd,
  selected,
  onOpenFile,
  canOpenToSide,
  badges,
  quiet,
  leading,
  actions,
  spaceAction,
  gapAbove,
}: FileTreeProps) {
  const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(() => new Map());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const rows = useMemo(
    () => flattenTree(sections, { open, listings, selected }),
    [sections, open, listings, selected],
  );
  const cols = useMemo(() => treeColumns(sections, badges), [sections, badges]);

  const toggle = useCallback((row: Extract<TreeRow, { kind: 'folder' }>) => {
    setOpen((m) => new Map(m).set(openKey(row.section, row.folder.path), !row.open));
  }, []);

  // Lazy folders read when they open, once per folder (per `cwd`).
  const requested = useRef(new Set<string>());
  useEffect(() => {
    requested.current = new Set();
    setListings(new Map());
  }, [cwd]);
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
  }, [rows, cwd]);

  // ── Focus: one tab stop, moved by the arrow keys ──
  const listRef = useRef<VirtualListHandle>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  /** A row to focus once it renders (it may be scrolled out of the window). */
  const pendingFocus = useRef<string | null>(null);
  const focusRow = (index: number) => {
    const key = rows[index]!.key;
    setFocusKey(key);
    pendingFocus.current = key;
    listRef.current?.scrollToIndex(index);
  };
  useEffect(() => {
    const key = pendingFocus.current;
    const el = key && elements.current.get(key);
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
  });
  const selectedIndex = rows.findIndex((r) => isSelected(r, selected));
  const tabStop =
    (focusKey !== null && rows.some((r) => r.key === focusKey) && focusKey) ||
    rows[selectedIndex]?.key ||
    rows.find((r) => r.kind === 'folder' || r.kind === 'file')?.key;

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
    focusRow(index);
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const index = rows.findIndex((r) => r.key === (e.target as HTMLElement).dataset.key);
    if (index < 0) return;
    const action = treeKey(rows, index, e.key);
    if (!action) return;
    e.preventDefault();
    if ('focus' in action) focusRow(action.focus);
    else toggle(rows[action.toggle] as Extract<TreeRow, { kind: 'folder' }>);
  };

  return (
    <VirtualList
      role="tree"
      handleRef={listRef}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1"
      gapAbove={gapAbove}
      count={rows.length}
      itemKey={(i) => rows[i]!.key}
      estimateSize={(i) => estimate(rows[i])}
    >
      {(i) => {
        const row = rows[i]!;
        if (row.kind === 'section') return <SectionHeader label={row.label} />;
        if (row.kind === 'note') return <TreeNote row={row} leading={!!leading} />;
        const path = row.kind === 'file' ? row.file.path : row.folder.path;
        return (
          <TreeItem
            row={row}
            cwd={cwd}
            cols={cols}
            selected={i === selectedIndex || isSelected(row, selected)}
            quiet={row.kind === 'file' && (row.file.ignored || !!quiet?.has(path))}
            badges={row.kind === 'file' ? badges?.get(path) : undefined}
            tabStop={row.key === tabStop}
            leading={leading ? (leading(row) ?? null) : undefined}
            actions={actions?.(row) ?? null}
            onSpace={spaceAction?.(row) ?? undefined}
            canOpenToSide={canOpenToSide}
            onActivate={(opts) => (row.kind === 'file' ? onOpenFile(row, opts) : toggle(row))}
            onFocusRow={() => setFocusKey(row.key)}
            rowRef={(el) => {
              if (el) elements.current.set(row.key, el);
              else elements.current.delete(row.key);
            }}
          />
        );
      }}
    </VirtualList>
  );
}

/** A section's title ("Staged · 3"). */
function SectionHeader({ label }: { label: string }) {
  return (
    <div role="presentation" className="type-subheading px-2.5 pt-2 pb-1">
      {label}
    </div>
  );
}
