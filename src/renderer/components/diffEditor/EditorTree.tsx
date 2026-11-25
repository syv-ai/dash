import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  FileText,
  FolderOpen,
  Link2,
} from 'lucide-react';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { LineStats } from '../ui/LineStats';
import { IconButton } from '../ui/IconButton';
import { IdeIcon } from '../ui/IdeIcon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { openInIde } from '../../lib/openInIde';
import { absolutePath } from './editor/fileRef';
import { copyText, revealLabel } from './fileActions';
import type { DirEntry, FileChange, FileChangeStatus, RepoListing } from '../../../shared/types';
import type { EditorView } from './types';
import type { OpenOptions } from './tabs/editorLayout';
import { Tooltip } from '../ui/Tooltip';
import { useEditorTabs } from '../../stores/editorTabsStore';

interface EditorTreeProps {
  /** Repo root — needed to lazily list gitignored files under "show all files". */
  cwd: string;
  /** `cwd` is a task's worktree. Otherwise it is plain files: no changes to
   *  filter on, no ignored files. */
  git: boolean;
  view: EditorView;
  /** All file paths in the current view's source (whole repo, sorted). */
  allPaths: string[];
  /** Directories the listing names as one entry (symlinked ones): shown as
   *  folders, listed when opened. */
  repoDirs?: string[];
  /** Subset of paths that have a diff for this view, with status + line stats. */
  changedFiles: FileChange[];
  /** List only the changed files (and their folders), not the whole repo. */
  changedOnly: boolean;
  filesLoading: boolean;
  /** The file showing in the focused editor group. */
  selectedPath: string;
  /** Open a file in the focused group (a click: as its preview), or
   *  `toSide` in the other one. */
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  /** The editor shows one pane: a file's menu offers "Open in new pane".
   *  With two there's no new pane to open (⌥-click still opens in the other). */
  canOpenToSide: boolean;
  /** Per-file badge counts: your notes and comments, and (in a PR view) the
   *  PR's unresolved threads. */
  badgeCounts: Map<string, FileBadges>;
  /** Files read through (a PR's viewed marks): a quiet tick, the name dimmed. */
  viewed?: ReadonlySet<string>;
  /** A control at the header's end (review mode's "All files"). */
  headerAction?: React.ReactNode;
}

/** A file's badges in the tree. */
export interface FileBadges {
  /** Your notes and comments needing attention (unsent, or PR comments). */
  comments: number;
  /** The PR's unresolved threads on the file. */
  threads: number;
}

const NO_DIRS: string[] = [];
const NONE_VIEWED: ReadonlySet<string> = new Set();
const NO_LISTING: RepoListing = { files: [], dirs: [] };

/** The editor's file tree: the view's changed files, or the whole repo. */
export function EditorTree(props: EditorTreeProps) {
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <FileTreePanel
        cwd={props.cwd}
        git={props.git}
        view={props.view}
        paths={props.allPaths}
        dirs={props.repoDirs ?? NO_DIRS}
        changedFiles={props.changedFiles}
        changedOnly={props.changedOnly}
        loading={props.filesLoading}
        selectedPath={props.selectedPath}
        onOpenFile={props.onOpenFile}
        canOpenToSide={props.canOpenToSide}
        badgeCounts={props.badgeCounts}
        viewed={props.viewed ?? NONE_VIEWED}
        headerAction={props.headerAction}
      />
    </div>
  );
}

// ── File tree ────────────────────────────────────────────────

interface TreeFile {
  name: string;
  fullPath: string;
  change: FileChange | null;
  /** Inside an ignored folder: shown quietly, with no status of its own. */
  dimmed?: boolean;
}

interface TreeFolder {
  name: string;
  fullPath: string;
  children: Map<string, TreeFolder>;
  files: TreeFile[];
  changedCount: number;
  dominantStatus: FileChangeStatus | null;
  /** Git lists it as one entry (ignored, or a symlink): its contents are
   *  read from disk when it opens, one level at a time. */
  lazy: boolean;
  /** Gitignored (or inside an ignored folder): dimmed. */
  ignored: boolean;
  /** Its own change, when git sees the folder as one entry (an untracked
   *  symlinked directory). */
  change: FileChange | null;
}

const STATUS_PRIORITY: FileChangeStatus[] = [
  'conflicted',
  'modified',
  'deleted',
  'renamed',
  'added',
  'untracked',
];

function newFolder(
  name: string,
  fullPath: string,
  opts: { lazy?: boolean; ignored?: boolean } = {},
): TreeFolder {
  return {
    name,
    fullPath,
    children: new Map(),
    files: [],
    changedCount: 0,
    dominantStatus: null,
    lazy: opts.lazy ?? false,
    ignored: opts.ignored ?? false,
    change: null,
  };
}

/** The folder at `parts` under `root`, made (with its parents) if missing. */
function folderAt(root: TreeFolder, parts: string[]): TreeFolder {
  let node = root;
  for (const seg of parts) {
    let child = node.children.get(seg);
    if (!child) {
      const childPath = node.fullPath ? `${node.fullPath}/${seg}` : seg;
      child = newFolder(seg, childPath);
      node.children.set(seg, child);
    }
    node = child;
  }
  return node;
}

function buildRepoTree(
  paths: string[],
  changedFiles: FileChange[],
  ignored: RepoListing,
  /** Folders listed lazily (symlinked directories). */
  lazyDirs: string[],
  /** Show the lazy folders even with no change of their own. */
  withLazyDirs: boolean,
): TreeFolder {
  const changedByPath = new Map<string, FileChange>();
  for (const f of changedFiles) changedByPath.set(f.path, f);
  const ignoredSet = new Set<string>(ignored.files);
  const root = newFolder('', '');

  // Folders git lists as one entry. An untracked symlinked directory is also
  // a "changed file": it becomes the folder's own change instead.
  const lazySet = new Set<string>();
  const addLazy = (p: string, isIgnored: boolean) => {
    const folder = folderAt(root, p.split('/'));
    folder.lazy = true;
    folder.ignored = isIgnored;
    folder.change = changedByPath.get(p) ?? null;
    lazySet.add(p);
  };
  for (const p of lazyDirs) if (withLazyDirs || changedByPath.has(p)) addLazy(p, false);
  for (const p of ignored.dirs) addLazy(p, true);

  // Use the union of repo paths, changed paths (e.g. deleted files may not be in
  // `paths` for the working view but are still in changedFiles), and any opted-in
  // ignored paths.
  const all = new Set<string>(paths);
  for (const f of changedFiles) all.add(f.path);
  for (const p of ignored.files) all.add(p);

  for (const p of Array.from(all).sort()) {
    if (lazySet.has(p)) continue;
    const parts = p.split('/');
    const node = folderAt(root, parts.slice(0, -1));
    // A tracked change wins over an ignored marker (a path can't be both, but be
    // deterministic). Ignored paths get a synthetic, zero-stat change so they
    // render with the low-emphasis "I" badge.
    const change: FileChange | null =
      changedByPath.get(p) ??
      (ignoredSet.has(p)
        ? { path: p, status: 'ignored', staged: false, additions: 0, deletions: 0 }
        : null);
    node.files.push({
      name: parts[parts.length - 1]!,
      fullPath: p,
      change,
    });
  }

  function aggregate(node: TreeFolder) {
    const statuses = new Set<FileChangeStatus>();
    let changed = 0;
    if (node.change) {
      statuses.add(node.change.status);
      changed++;
    }
    for (const file of node.files) {
      // Ignored files are shown but never counted as "changed" or allowed to
      // tint their parent folders.
      if (file.change && file.change.status !== 'ignored') {
        statuses.add(file.change.status);
        changed++;
      }
    }
    for (const child of node.children.values()) {
      aggregate(child);
      changed += child.changedCount;
      if (child.dominantStatus) statuses.add(child.dominantStatus);
    }
    node.changedCount = changed;
    node.dominantStatus = pickDominant(statuses);
  }
  aggregate(root);
  return root;
}

/** Widths (in `ch`, a tabular digit's width) of the trailing stat columns,
 *  each sized to the widest value in the tree so rows line up with no slack.
 *  0 = no row fills that column, so it isn't drawn. */
interface TreeColumns {
  comments: boolean;
  threads: boolean;
  add: number;
  del: number;
  /** The status letter on files and the changed count on folders share it. */
  status: number;
}

function treeColumns(root: TreeFolder, badgeCounts: Map<string, FileBadges>): TreeColumns {
  const cols: TreeColumns = { comments: false, threads: false, add: 0, del: 0, status: 0 };
  const walk = (node: TreeFolder) => {
    for (const f of node.files) {
      const badges = badgeCounts.get(f.fullPath);
      if (badges?.comments) cols.comments = true;
      if (badges?.threads) cols.threads = true;
      const c = f.change;
      if (!c) continue;
      cols.status = Math.max(cols.status, 1);
      if (c.additions > 0) cols.add = Math.max(cols.add, String(c.additions).length + 1);
      if (c.deletions > 0) cols.del = Math.max(cols.del, String(c.deletions).length + 1);
    }
    for (const child of node.children.values()) {
      if (child.changedCount > 0) {
        cols.status = Math.max(cols.status, String(child.changedCount).length);
      }
      walk(child);
    }
  };
  walk(root);
  return cols;
}

function CopyPathAction({ path }: { path: string }) {
  return (
    <IconButton
      onClick={(e) => {
        e.stopPropagation();
        copyText(path, 'relative path');
      }}
      title="Copy relative path"
      size="sm"
    >
      <Copy size={11} strokeWidth={1.8} />
    </IconButton>
  );
}

/** A tree row: a div (it holds the copy button, which a <button> can't) that
 *  still activates on click, Enter and Space (with ⌥: `alt`). `group/swap`
 *  drives HoverSwapSlot. */
const TreeRow = React.forwardRef<
  HTMLDivElement,
  {
    onActivate: (alt: boolean) => void;
    className: string;
    style: React.CSSProperties;
    title?: string;
    children: React.ReactNode;
  } & Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick' | 'onKeyDown'>
>(function TreeRow({ onActivate, className, style, title, children, ...rest }, ref) {
  return (
    <div
      {...rest}
      ref={ref}
      role="button"
      tabIndex={0}
      title={title}
      onClick={(e) => onActivate(e.altKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate(e.altKey);
        }
      }}
      style={style}
      className={`group/swap w-full flex items-center gap-1 py-0.5 rounded-md text-sm cursor-pointer outline-hidden focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors ${className}`}
    >
      {children}
    </div>
  );
});

function pickDominant(statuses: Set<FileChangeStatus>): FileChangeStatus | null {
  if (statuses.size === 0) return null;
  for (const s of STATUS_PRIORITY) if (statuses.has(s)) return s;
  return null;
}

const STATUS_LABEL: Record<FileChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
  ignored: 'I',
};

const STATUS_TEXT: Record<FileChangeStatus, string> = {
  modified: 'text-[hsl(var(--git-modified))]',
  added: 'text-loc-add',
  deleted: 'text-loc-del',
  renamed: 'text-[hsl(var(--git-renamed))]',
  untracked: 'text-[hsl(var(--git-untracked))]',
  conflicted: 'text-[hsl(var(--git-conflicted))]',
  // No dedicated token — ignored files are intentionally low-emphasis (muted).
  ignored: 'text-muted-fade-40',
};

const FOLDER_TINT: Record<FileChangeStatus, string> = {
  modified: 'text-[hsl(var(--git-modified)/0.85)]',
  added: 'text-[hsl(var(--git-added)/0.85)]',
  deleted: 'text-[hsl(var(--git-deleted)/0.85)]',
  renamed: 'text-[hsl(var(--git-renamed)/0.85)]',
  untracked: 'text-[hsl(var(--git-untracked))]',
  conflicted: 'text-[hsl(var(--git-conflicted)/0.85)]',
  // Never used for folder tint (ignored is absent from STATUS_PRIORITY, so
  // pickDominant won't select it) — present only to satisfy the record type.
  ignored: 'text-muted-fade-40',
};

interface FileTreePanelProps {
  cwd: string;
  git: boolean;
  view: EditorView;
  paths: string[];
  dirs: string[];
  changedFiles: FileChange[];
  changedOnly: boolean;
  loading: boolean;
  selectedPath: string;
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  canOpenToSide: boolean;
  badgeCounts: Map<string, FileBadges>;
  viewed: ReadonlySet<string>;
  headerAction?: React.ReactNode;
}

/** What every row needs, passed down the tree once. */
interface TreeContextValue {
  cwd: string;
  selectedPath: string;
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  canOpenToSide: boolean;
  badgeCounts: Map<string, FileBadges>;
  viewed: ReadonlySet<string>;
  cols: TreeColumns;
}

const TreeContext = createContext<TreeContextValue | null>(null);

function useTree(): TreeContextValue {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error('useTree outside FileTreePanel');
  return ctx;
}

function FileTreePanel({
  cwd,
  git,
  view,
  paths,
  dirs,
  changedFiles,
  changedOnly: changedOnlyProp,
  loading,
  selectedPath,
  onOpenFile,
  canOpenToSide,
  badgeCounts,
  viewed,
  headerAction,
}: FileTreePanelProps) {
  // Plain files have no changes to filter on, and nothing git ignores.
  const changedOnly = git && changedOnlyProp;

  // "Show all files" means every local file, gitignored ones included, so the
  // user can reach a local-only config or scratch file. Ignored files are a
  // working-tree concept (a commit's tree can't contain them), so the fetch is
  // gated on the working view; git collapses fully-ignored directories to one
  // entry (a dimmed folder, read only when opened), which keeps
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
      if (cancelled) return;
      setIgnored(resp.success && resp.data ? resp.data : NO_LISTING);
    });
    return () => {
      cancelled = true;
    };
  }, [showIgnored, cwd]);

  // In changed-only mode, seed the tree from an empty repo-path set so
  // buildRepoTree's union reduces to just the changed files and their parent
  // folders (unchanged siblings never enter the tree). The ignored listing is already
  // empty in that mode.
  const tree = useMemo(
    () => buildRepoTree(changedOnly ? [] : paths, changedFiles, ignored, dirs, !changedOnly),
    [changedOnly, paths, changedFiles, ignored, dirs],
  );
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of changedFiles) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { additions, deletions };
  }, [changedFiles]);
  const cols = useMemo(() => treeColumns(tree, badgeCounts), [tree, badgeCounts]);
  const ctx = useMemo<TreeContextValue>(
    () => ({ cwd, selectedPath, onOpenFile, canOpenToSide, badgeCounts, viewed, cols }),
    [cwd, selectedPath, onOpenFile, canOpenToSide, badgeCounts, viewed, cols],
  );
  return (
    <TreeContext.Provider value={ctx}>
      <div className="h-full min-h-0 flex flex-col">
        <div className="px-3 py-2 text-xs text-ink-3 flex items-center justify-between shrink-0">
          <span className="flex items-center gap-2">
            <span>
              Files{' '}
              {tree.changedCount > 0 && (
                <span className="tabular-nums">· {tree.changedCount} changed</span>
              )}
            </span>
            <span className="text-xs">
              <LineStats add={totals.additions} del={totals.deletions} />
            </span>
          </span>
          {headerAction}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable scrollbar-thin-hover pb-2 px-1">
          {loading && paths.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-fade-40">Loading…</div>
          ) : changedOnly && tree.changedCount === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-fade-40">No changed files</div>
          ) : (
            <FolderContents node={tree} indent={0} />
          )}
        </div>
      </div>
    </TreeContext.Provider>
  );
}

function FolderContents({ node, indent }: { node: TreeFolder; indent: number }) {
  const { selectedPath, onOpenFile, badgeCounts, viewed, cols } = useTree();
  const childFolders = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return (
    <>
      {childFolders.map((child) => (
        <FolderEntry key={`d-${child.fullPath}`} folder={child} indent={indent} />
      ))}
      {node.files.map((file) => (
        <FileEntry
          key={`f-${file.fullPath}`}
          file={file}
          indent={indent}
          selected={file.fullPath === selectedPath}
          badges={badgeCounts.get(file.fullPath)}
          viewed={viewed.has(file.fullPath)}
          onOpen={(opts) => onOpenFile(file.fullPath, opts)}
          cols={cols}
        />
      ))}
    </>
  );
}

/** A lazy folder's contents, read from disk when it opens: one level, its
 *  subfolders lazy in turn. */
function LazyFolderContents({ folder, indent }: { folder: TreeFolder; indent: number }) {
  const { cwd } = useTree();
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.editorListDir({ cwd, dirPath: folder.fullPath }).then((resp) => {
      if (cancelled) return;
      if (resp.success && resp.data) setEntries(resp.data);
      else setError(resp.error ?? 'Could not list folder');
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, folder.fullPath]);

  const node = useMemo(() => {
    const n = newFolder(folder.name, folder.fullPath);
    for (const e of entries ?? []) {
      const fullPath = `${folder.fullPath}/${e.name}`;
      if (e.dir) {
        n.children.set(
          e.name,
          newFolder(e.name, fullPath, { lazy: true, ignored: folder.ignored }),
        );
      } else {
        n.files.push({ name: e.name, fullPath, change: null, dimmed: folder.ignored });
      }
    }
    return n;
  }, [entries, folder]);

  const pad = { paddingLeft: 4 + indent * INDENT_STEP + ICON_SLOT + 4 };
  if (error) {
    return (
      <div className="py-0.5 text-xs text-muted-fade-55 truncate" style={pad} title={error}>
        {error}
      </div>
    );
  }
  if (!entries) {
    return (
      <div className="py-0.5 text-xs text-muted-fade-40" style={pad}>
        Loading…
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="py-0.5 text-xs text-muted-fade-40" style={pad}>
        Empty
      </div>
    );
  }
  return <FolderContents node={node} indent={indent} />;
}

// Width of the leading icon column. Folders fill it with a chevron; files
// leave it empty so file names align with folder names at the same indent
// (chevron column = name's left edge).
const ICON_SLOT = 12;
const INDENT_STEP = 10; // px per nesting level (Tailwind gap-1 = 4px is used inside rows)

function FolderEntry({ folder, indent }: { folder: TreeFolder; indent: number }) {
  const { selectedPath, cols } = useTree();
  // Default-open if the folder has changes OR it contains the file the editor
  // opened to — so that file is never hidden in a collapsed folder. The user's
  // collapse/expand owns it after. A lazy folder starts closed: opening it is
  // what reads it.
  const [open, setOpen] = useState<boolean>(
    () =>
      !folder.lazy && (folder.changedCount > 0 || selectedPath.startsWith(`${folder.fullPath}/`)),
  );
  // `changedFiles` load async, so at mount `changedCount` is often still 0 and
  // the lazy init above misses changed folders (an intermittent "collapsed on
  // open" race). Re-seed open exactly once when a folder *first* gains changed
  // files; the guard means a later manual collapse is never clobbered.
  const seededFromChanges = useRef(folder.changedCount > 0);
  useEffect(() => {
    if (!seededFromChanges.current && folder.changedCount > 0) {
      seededFromChanges.current = true;
      if (!folder.lazy) setOpen(true);
    }
  }, [folder.changedCount, folder.lazy]);
  // Asked to show a folder (a tab that named it): open it and its parents.
  const expand = useEditorTabs((s) => s.expandFolder);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expand) return;
    if (expand.path === folder.fullPath) {
      setOpen(true);
      rowRef.current?.scrollIntoView({ block: 'nearest' });
      rowRef.current?.focus();
    } else if (expand.path.startsWith(`${folder.fullPath}/`)) {
      setOpen(true);
    }
  }, [expand, folder.fullPath]);

  const tint = folder.ignored
    ? 'text-muted-fade-55'
    : folder.dominantStatus
      ? FOLDER_TINT[folder.dominantStatus]
      : 'text-fg-fade-90';
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TreeRow
            ref={rowRef}
            aria-expanded={open}
            onActivate={() => setOpen((v) => !v)}
            className="hover:bg-[hsl(var(--surface-2)/0.6)]"
            style={{ paddingLeft: 4 + indent * INDENT_STEP, paddingRight: 8 }}
          >
            <span
              className="shrink-0 inline-flex items-center justify-center"
              style={{ width: ICON_SLOT }}
            >
              {open ? (
                <ChevronDown size={11} strokeWidth={1.8} className="text-icon" />
              ) : (
                <ChevronRight size={11} strokeWidth={1.8} className="text-icon" />
              )}
            </span>
            <span className={`flex-1 min-w-0 text-sm truncate text-left ${tint}`}>
              {folder.name}
              <span className="text-muted-fade-40">/</span>
            </span>
            <HoverSwapSlot
              rest={
                cols.status > 0 && (
                  <span
                    className={`text-xs font-semibold tabular-nums text-center ${
                      folder.dominantStatus
                        ? STATUS_TEXT[folder.dominantStatus]
                        : 'text-muted-fade-70'
                    }`}
                    style={{ width: `${cols.status}ch` }}
                    aria-label={
                      folder.changedCount > 0 ? `${folder.changedCount} changed` : undefined
                    }
                  >
                    {folder.changedCount > 0 ? folder.changedCount : ''}
                  </span>
                )
              }
              actions={<CopyPathAction path={folder.fullPath} />}
            />
          </TreeRow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <FolderMenu path={folder.fullPath} open={open} onToggle={() => setOpen((v) => !v)} />
        </ContextMenuContent>
      </ContextMenu>
      {open &&
        (folder.lazy ? (
          <LazyFolderContents folder={folder} indent={indent + 1} />
        ) : (
          <FolderContents node={folder} indent={indent + 1} />
        ))}
    </>
  );
}

/** The PR's unresolved threads on a file: outlined, so it reads apart from yours. */
function ThreadBadge({ count }: { count: number }) {
  const label = `${count} unresolved thread${count !== 1 ? 's' : ''}`;
  return (
    <Tooltip content={label}>
      <span
        aria-label={label}
        className="shrink-0 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-xs font-semibold tabular-nums border border-edge/25 text-fg-fade-70"
      >
        {count}
      </span>
    </Tooltip>
  );
}

function CommentBadge({ count }: { count: number }) {
  const label = `${count} comment${count !== 1 ? 's' : ''}`;
  return (
    <Tooltip content={label}>
      <span
        aria-label={label}
        className="shrink-0 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-xs font-semibold tabular-nums bg-primary/20 text-primary"
      >
        {count}
      </span>
    </Tooltip>
  );
}

function FileEntry({
  file,
  indent,
  selected,
  badges,
  viewed,
  onOpen,
  cols,
}: {
  file: TreeFile;
  indent: number;
  selected: boolean;
  badges: FileBadges | undefined;
  /** Read through: a tick in the icon slot, the name dimmed. */
  viewed: boolean;
  /** Open in the last focused pane (a click: as its preview; a double-click
   *  keeps it); ⌥-click or "Open in new pane": in the other pane. */
  onOpen: (opts?: OpenOptions) => void;
  cols: TreeColumns;
}) {
  const change = file.change;
  const tint = selected
    ? 'text-primary'
    : viewed
      ? 'text-ink-3'
      : change
        ? STATUS_TEXT[change.status]
        : file.dimmed
          ? 'text-muted-fade-55'
          : 'text-fg-fade-80';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TreeRow
          onActivate={(alt) => onOpen({ toSide: alt, preview: true })}
          onDoubleClick={() => onOpen()}
          title={file.fullPath}
          style={{ paddingLeft: 4 + indent * INDENT_STEP, paddingRight: 8 }}
          className={selected ? 'bg-primary/15' : 'hover:bg-[hsl(var(--surface-2)/0.6)]'}
        >
          {/* Empty icon slot keeps file names aligned with folder names at the
          same indent (the chevron column for folders). */}
          <span className="flex shrink-0 justify-center" style={{ width: ICON_SLOT }}>
            {viewed && (
              <Check size={11} strokeWidth={1.8} className="text-icon" aria-label="Viewed" />
            )}
          </span>
          <span className={`flex-1 min-w-0 text-sm truncate text-left ${tint}`}>{file.name}</span>
          {/* Stat columns at rest (each as wide as the tree's widest value, so
          they line up down the list); "Copy relative path" slides in on hover. */}
          <HoverSwapSlot
            rest={
              <span className="flex items-center gap-1.5 text-xs tabular-nums">
                {cols.threads && (
                  <span className="flex w-[18px] justify-end">
                    {!!badges?.threads && <ThreadBadge count={badges.threads} />}
                  </span>
                )}
                {cols.comments && (
                  <span className="flex w-[18px] justify-end">
                    {!!badges?.comments && <CommentBadge count={badges.comments} />}
                  </span>
                )}
                {cols.add > 0 && (
                  <span className="text-right text-loc-add" style={{ width: `${cols.add}ch` }}>
                    {change && change.additions > 0 ? `+${change.additions}` : ''}
                  </span>
                )}
                {cols.del > 0 && (
                  <span className="text-right text-loc-del" style={{ width: `${cols.del}ch` }}>
                    {change && change.deletions > 0 ? `−${change.deletions}` : ''}
                  </span>
                )}
                {cols.status > 0 && (
                  <span
                    className={`text-xs font-semibold text-center ${
                      change ? (selected ? 'text-primary' : STATUS_TEXT[change.status]) : ''
                    }`}
                    style={{ width: `${cols.status}ch` }}
                  >
                    {change ? STATUS_LABEL[change.status] : ''}
                  </span>
                )}
              </span>
            }
            actions={<CopyPathAction path={file.fullPath} />}
          />
        </TreeRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FileMenu path={file.fullPath} onOpen={onOpen} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A file's right-click menu. Mounted only while open, so the rows don't each
 *  subscribe to the IDE setting. */
function FileMenu({ path, onOpen }: { path: string; onOpen: (opts?: OpenOptions) => void }) {
  const { cwd, canOpenToSide } = useTree();
  const { ideId, openLabel } = usePreferredIde();
  const abs = absolutePath(cwd, path);
  return (
    <ContextMenuItems
      items={[
        // A menu open is deliberate: it keeps its tab (a click only previews).
        { label: 'Open', icon: FileText, onSelect: () => onOpen() },
        canOpenToSide && {
          label: 'Open in new pane',
          icon: Columns2,
          onSelect: () => onOpen({ toSide: true }),
        },
        'separator',
        { label: 'Copy path', icon: Link2, onSelect: () => copyText(abs, 'path') },
        {
          label: 'Copy relative path',
          icon: Copy,
          onSelect: () => copyText(path, 'relative path'),
        },
        'separator',
        {
          label: revealLabel(),
          icon: FolderOpen,
          onSelect: () => window.electronAPI.showItemInFolder(abs),
        },
        {
          label: openLabel,
          icon: (
            <span className="inline-flex size-3.5 items-center justify-center">
              <IdeIcon ideId={ideId} size={14} />
            </span>
          ),
          onSelect: () => void openInIde(abs),
        },
      ]}
    />
  );
}

/** A folder's right-click menu. */
function FolderMenu({
  path,
  open,
  onToggle,
}: {
  path: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { cwd } = useTree();
  const abs = absolutePath(cwd, path);
  return (
    <ContextMenuItems
      items={[
        open
          ? { label: 'Collapse', icon: ChevronsDownUp, onSelect: onToggle }
          : { label: 'Expand', icon: ChevronsUpDown, onSelect: onToggle },
        'separator',
        { label: 'Copy path', icon: Link2, onSelect: () => copyText(abs, 'path') },
        {
          label: 'Copy relative path',
          icon: Copy,
          onSelect: () => copyText(path, 'relative path'),
        },
        'separator',
        {
          label: revealLabel(),
          icon: FolderOpen,
          onSelect: () => window.electronAPI.showItemInFolder(abs),
        },
      ]}
    />
  );
}
