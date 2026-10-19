import React, { useMemo, useRef, useState, useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GitCommit,
  GitPullRequestArrow,
  History,
  ListFilter,
} from 'lucide-react';
import { toast } from 'sonner';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { IconButton } from '../ui/IconButton';
import type { FileChange, FileChangeStatus } from '../../../shared/types';
import { formatRelativeTime } from '@shared/relativeTime';
import type { CommitSummary, EditorView } from './types';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';

interface EditorSidebarProps {
  /** Repo root — needed to lazily list gitignored files under "show all files". */
  cwd: string;
  /** All file paths in the current view's source (whole repo, sorted). */
  allPaths: string[];
  /** Subset of paths that have a diff for this view, with status + line stats. */
  changedFiles: FileChange[];
  filesLoading: boolean;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  /** Per-file badge counts: your notes and comments, and (in a PR view) the
   *  PR's unresolved threads. */
  badgeCounts: Map<string, FileBadges>;

  commits: CommitSummary[];
  commitsLoading: boolean;
  /** Comment count per scope ('live' / 'commit:<hash>') → badge on each row. */
  commentCountByScope: Map<string, number>;
  view: EditorView;
  onSelectView: (view: EditorView) => void;
  /** The task's open GitHub PR, shown as a row that opens the PR view. */
  pr?: PrEntry | null;
}

/** A file's badges in the tree. */
export interface FileBadges {
  /** Your notes and comments needing attention (unsent, or PR comments). */
  comments: number;
  /** The PR's unresolved threads on the file. */
  threads: number;
}

/** The task's open PR in the commits drawer; `threads` is null until its review is fetched. */
export interface PrEntry {
  number: number;
  threads: number | null;
  onOpen: () => void;
}

const COMMITS_DRAWER_KEY = 'diffEditor.commitsDrawerSize';
const CHANGED_ONLY_KEY = 'diffEditor.changedOnly';

export function EditorSidebar(props: EditorSidebarProps) {
  const initialDrawerSize = parseInitial(localStorage.getItem(COMMITS_DRAWER_KEY), 35);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PanelGroup
        direction="vertical"
        autoSaveId="diff-editor-sidebar"
        onLayout={(sizes) => {
          if (sizes[1] != null) localStorage.setItem(COMMITS_DRAWER_KEY, String(sizes[1]));
        }}
      >
        <Panel minSize={20}>
          <FileTreePanel
            cwd={props.cwd}
            view={props.view}
            paths={props.allPaths}
            changedFiles={props.changedFiles}
            loading={props.filesLoading}
            selectedPath={props.selectedPath}
            onSelectFile={props.onSelectFile}
            badgeCounts={props.badgeCounts}
          />
        </Panel>
        <PanelResizeHandle className="h-px bg-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--border))] transition-colors" />
        <Panel defaultSize={initialDrawerSize} minSize={10} maxSize={70}>
          <CommitsDrawer
            commits={props.commits}
            loading={props.commitsLoading}
            commentCountByScope={props.commentCountByScope}
            view={props.view}
            onSelectView={props.onSelectView}
            pr={props.pr}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}

function parseInitial(stored: string | null, fallback: number): number {
  if (!stored) return fallback;
  const n = parseFloat(stored);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : fallback;
}

// ── File tree ────────────────────────────────────────────────

interface TreeFile {
  name: string;
  fullPath: string;
  change: FileChange | null;
}

interface TreeFolder {
  name: string;
  fullPath: string;
  children: Map<string, TreeFolder>;
  files: TreeFile[];
  changedCount: number;
  dominantStatus: FileChangeStatus | null;
}

const STATUS_PRIORITY: FileChangeStatus[] = [
  'conflicted',
  'modified',
  'deleted',
  'renamed',
  'added',
  'untracked',
];

function newFolder(name: string, fullPath: string): TreeFolder {
  return {
    name,
    fullPath,
    children: new Map(),
    files: [],
    changedCount: 0,
    dominantStatus: null,
  };
}

function buildRepoTree(
  paths: string[],
  changedFiles: FileChange[],
  ignoredPaths: string[] = [],
): TreeFolder {
  const changedByPath = new Map<string, FileChange>();
  for (const f of changedFiles) changedByPath.set(f.path, f);
  const ignoredSet = new Set<string>(ignoredPaths);

  // Use the union of repo paths, changed paths (e.g. deleted files may not be in
  // `paths` for the working view but are still in changedFiles), and any opted-in
  // ignored paths.
  const all = new Set<string>(paths);
  for (const f of changedFiles) all.add(f.path);
  for (const p of ignoredPaths) all.add(p);

  const root = newFolder('', '');
  for (const p of Array.from(all).sort()) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      let child = node.children.get(seg);
      if (!child) {
        const childPath = node.fullPath ? `${node.fullPath}/${seg}` : seg;
        child = newFolder(seg, childPath);
        node.children.set(seg, child);
      }
      node = child;
    }
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

/** Widths (in `ch` of the tree's monospace font) of the trailing stat columns,
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

function copyPath(path: string) {
  void window.electronAPI.clipboardWriteText(path);
  toast('Copied path', { description: path, duration: 1800 });
}

function CopyPathAction({ path }: { path: string }) {
  return (
    <IconButton
      onClick={(e) => {
        e.stopPropagation();
        copyPath(path);
      }}
      title="Copy path"
      size="sm"
    >
      <Copy size={11} strokeWidth={1.8} />
    </IconButton>
  );
}

/** A tree row: a div (it holds the copy button, which a <button> can't) that
 *  still activates on click, Enter and Space. `group/swap` drives HoverSwapSlot. */
function TreeRow({
  onActivate,
  className,
  style,
  title,
  children,
}: {
  onActivate: () => void;
  className: string;
  style: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      style={style}
      className={`group/swap w-full flex items-center gap-1 py-0.5 rounded-md text-[12px] cursor-pointer outline-hidden focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors ${className}`}
    >
      {children}
    </div>
  );
}

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
  added: 'text-[hsl(var(--git-added))]',
  deleted: 'text-[hsl(var(--git-deleted))]',
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
  view: EditorView;
  paths: string[];
  changedFiles: FileChange[];
  loading: boolean;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  badgeCounts: Map<string, FileBadges>;
}

function FileTreePanel({
  cwd,
  view,
  paths,
  changedFiles,
  loading,
  selectedPath,
  onSelectFile,
  badgeCounts,
}: FileTreePanelProps) {
  const [changedOnly, setChangedOnly] = useState<boolean>(
    () => localStorage.getItem(CHANGED_ONLY_KEY) === 'true',
  );
  const toggleChangedOnly = () =>
    setChangedOnly((v) => {
      const next = !v;
      localStorage.setItem(CHANGED_ONLY_KEY, String(next));
      return next;
    });

  // "Show all files" means every local file, gitignored ones included, so the
  // user can reach a local-only config or scratch file. Ignored files are a
  // working-tree concept (a commit's tree can't contain them), so the fetch is
  // gated on the working view; git collapses fully-ignored directories to one
  // entry, which keeps `node_modules/` from flooding the tree.
  const showIgnored = !changedOnly && view.kind === 'working';
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  useEffect(() => {
    if (!showIgnored) {
      setIgnoredPaths([]);
      return;
    }
    let cancelled = false;
    void window.electronAPI.editorListIgnoredFiles({ cwd }).then((resp) => {
      if (cancelled) return;
      setIgnoredPaths(resp.success && resp.data ? resp.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [showIgnored, cwd]);

  // In changed-only mode, seed the tree from an empty repo-path set so
  // buildRepoTree's union reduces to just the changed files and their parent
  // folders (unchanged siblings never enter the tree). ignoredPaths is already
  // empty in that mode.
  const tree = useMemo(
    () => buildRepoTree(changedOnly ? [] : paths, changedFiles, ignoredPaths),
    [changedOnly, paths, changedFiles, ignoredPaths],
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
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-fade-70 font-mono flex items-center justify-between shrink-0">
        <span className="flex items-center gap-2">
          <span>
            Files{' '}
            {tree.changedCount > 0 && (
              <span className="tabular-nums">· {tree.changedCount} changed</span>
            )}
          </span>
          {(totals.additions > 0 || totals.deletions > 0) && (
            <span className="flex gap-1.5 tabular-nums normal-case tracking-normal">
              {totals.additions > 0 && (
                <span className="text-[hsl(var(--git-added))]">+{totals.additions}</span>
              )}
              {totals.deletions > 0 && (
                <span className="text-[hsl(var(--git-deleted))]">−{totals.deletions}</span>
              )}
            </span>
          )}
        </span>
        <span className="flex items-center gap-0.5">
          <Tooltip content={changedOnly ? 'Show all files' : 'Show changed files only'}>
            <button
              type="button"
              onClick={toggleChangedOnly}
              aria-pressed={changedOnly}
              className={`shrink-0 p-1 -mr-1 rounded transition-colors ${
                changedOnly
                  ? 'text-primary'
                  : 'text-muted-fade-50 hover:text-foreground hover:bg-[hsl(var(--surface-2)/0.6)]'
              }`}
            >
              <ListFilter size={13} strokeWidth={1.8} />
            </button>
          </Tooltip>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable scrollbar-thin-hover pb-2 px-1">
        {loading && paths.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-fade-40">Loading…</div>
        ) : changedOnly && tree.changedCount === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-fade-40">No changed files</div>
        ) : (
          <FolderContents
            node={tree}
            indent={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            badgeCounts={badgeCounts}
            cols={cols}
          />
        )}
      </div>
    </div>
  );
}

interface FolderContentsProps {
  node: TreeFolder;
  indent: number;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  badgeCounts: Map<string, FileBadges>;
  cols: TreeColumns;
}

function FolderContents({
  node,
  indent,
  selectedPath,
  onSelectFile,
  badgeCounts,
  cols,
}: FolderContentsProps) {
  const childFolders = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const childFiles = node.files;
  return (
    <>
      {childFolders.map((child) => (
        <FolderEntry
          key={`d-${child.fullPath}`}
          folder={child}
          indent={indent}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          badgeCounts={badgeCounts}
          cols={cols}
        />
      ))}
      {childFiles.map((file) => (
        <FileEntry
          key={`f-${file.fullPath}`}
          file={file}
          indent={indent}
          selected={file.fullPath === selectedPath}
          badges={badgeCounts.get(file.fullPath)}
          onClick={() => onSelectFile(file.fullPath)}
          cols={cols}
        />
      ))}
    </>
  );
}

// Width of the leading icon column. Folders fill it with a chevron; files
// leave it empty so file names align with folder names at the same indent
// (chevron column = name's left edge).
const ICON_SLOT = 12;
const INDENT_STEP = 10; // px per nesting level (Tailwind gap-1 = 4px is used inside rows)

function FolderEntry({
  folder,
  indent,
  selectedPath,
  onSelectFile,
  badgeCounts,
  cols,
}: {
  folder: TreeFolder;
  indent: number;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  badgeCounts: Map<string, FileBadges>;
  cols: TreeColumns;
}) {
  // Default-open if the folder has changes OR it contains the file the editor
  // opened to — so that file is never hidden in a collapsed folder. The user's
  // collapse/expand owns it after.
  const [open, setOpen] = useState<boolean>(
    () => folder.changedCount > 0 || selectedPath.startsWith(`${folder.fullPath}/`),
  );
  // `changedFiles` load async, so at mount `changedCount` is often still 0 and
  // the lazy init above misses changed folders (an intermittent "collapsed on
  // open" race). Re-seed open exactly once when a folder *first* gains changed
  // files; the guard means a later manual collapse is never clobbered.
  const seededFromChanges = useRef(folder.changedCount > 0);
  useEffect(() => {
    if (!seededFromChanges.current && folder.changedCount > 0) {
      seededFromChanges.current = true;
      setOpen(true);
    }
  }, [folder.changedCount]);
  const tint = folder.dominantStatus ? FOLDER_TINT[folder.dominantStatus] : 'text-fg-fade-90';
  return (
    <>
      <TreeRow
        onActivate={() => setOpen((v) => !v)}
        className="hover:bg-[hsl(var(--surface-2)/0.6)]"
        style={{ paddingLeft: 4 + indent * INDENT_STEP, paddingRight: 8 }}
      >
        <span
          className="shrink-0 inline-flex items-center justify-center"
          style={{ width: ICON_SLOT }}
        >
          {open ? (
            <ChevronDown size={11} strokeWidth={1.8} className="text-muted-fade-55" />
          ) : (
            <ChevronRight size={11} strokeWidth={1.8} className="text-muted-fade-55" />
          )}
        </span>
        <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate text-left ${tint}`}>
          {folder.name}
          <span className="text-muted-fade-40">/</span>
        </span>
        <HoverSwapSlot
          rest={
            cols.status > 0 && (
              <span
                className={`font-mono text-[10px] font-semibold tabular-nums text-center ${
                  folder.dominantStatus ? STATUS_TEXT[folder.dominantStatus] : 'text-muted-fade-70'
                }`}
                style={{ width: `${cols.status}ch` }}
                aria-label={folder.changedCount > 0 ? `${folder.changedCount} changed` : undefined}
              >
                {folder.changedCount > 0 ? folder.changedCount : ''}
              </span>
            )
          }
          actions={<CopyPathAction path={folder.fullPath} />}
        />
      </TreeRow>
      {open && (
        <FolderContents
          node={folder}
          indent={indent + 1}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          badgeCounts={badgeCounts}
          cols={cols}
        />
      )}
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
        className="shrink-0 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full font-mono text-[9.5px] font-semibold tabular-nums border border-edge/25 text-fg-fade-70"
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
        className="shrink-0 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full font-mono text-[9.5px] font-semibold tabular-nums bg-primary/20 text-primary"
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
  onClick,
  cols,
}: {
  file: TreeFile;
  indent: number;
  selected: boolean;
  badges: FileBadges | undefined;
  onClick: () => void;
  cols: TreeColumns;
}) {
  const change = file.change;
  const tint = selected ? 'text-primary' : change ? STATUS_TEXT[change.status] : 'text-fg-fade-80';
  return (
    <TreeRow
      onActivate={onClick}
      title={file.fullPath}
      style={{ paddingLeft: 4 + indent * INDENT_STEP, paddingRight: 8 }}
      className={selected ? 'bg-primary/15' : 'hover:bg-[hsl(var(--surface-2)/0.6)]'}
    >
      {/* Empty icon slot keeps file names aligned with folder names at the
          same indent (the chevron column for folders). */}
      <span className="shrink-0" style={{ width: ICON_SLOT }} />
      <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate text-left ${tint}`}>
        {file.name}
      </span>
      {/* Stat columns at rest (each as wide as the tree's widest value, so
          they line up down the list); "Copy path" slides in on hover. */}
      <HoverSwapSlot
        rest={
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
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
              <span
                className={`text-right ${
                  change?.status === 'untracked'
                    ? 'text-muted-foreground'
                    : 'text-[hsl(var(--git-added))]'
                }`}
                style={{ width: `${cols.add}ch` }}
              >
                {change && change.additions > 0 ? `+${change.additions}` : ''}
              </span>
            )}
            {cols.del > 0 && (
              <span
                className="text-right text-[hsl(var(--git-deleted))]"
                style={{ width: `${cols.del}ch` }}
              >
                {change && change.deletions > 0 ? `−${change.deletions}` : ''}
              </span>
            )}
            {cols.status > 0 && (
              <span
                className={`text-[10px] font-semibold text-center ${
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
  );
}

// ── Commits drawer ───────────────────────────────────────────

interface CommitsDrawerProps {
  commits: CommitSummary[];
  loading: boolean;
  commentCountByScope: Map<string, number>;
  view: EditorView;
  onSelectView: (view: EditorView) => void;
  pr?: PrEntry | null;
}

function CommitsDrawer({
  commits,
  loading,
  commentCountByScope,
  view,
  onSelectView,
  pr,
}: CommitsDrawerProps) {
  const workingActive = view.kind === 'working';
  const activeCommitHash = view.kind === 'commit' ? view.hash : null;

  // Auto-scroll active commit into view when the view changes.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [view]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-fade-70 font-mono flex items-center gap-1.5 shrink-0">
        <History size={11} strokeWidth={1.8} />
        <span>Commits</span>
        {commits.length > 0 && <span className="ml-auto tabular-nums">{commits.length}</span>}
      </div>
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable scrollbar-thin-hover pb-2 px-1"
      >
        {/* Always pinned, even on a clean tree: it is the only editable view
            and the way back from a commit. */}
        <button
          type="button"
          data-active={workingActive}
          onClick={() => onSelectView({ kind: 'working', ref: 'HEAD' })}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left transition-colors ${
            workingActive
              ? 'bg-primary/15 text-primary'
              : 'text-fg-fade-85 hover:bg-[hsl(var(--surface-2)/0.6)]'
          }`}
        >
          <GitCommit size={11} strokeWidth={1.8} className="opacity-60 shrink-0" />
          <span className="truncate flex-1 font-mono text-[11.5px]">Working tree</span>
          {(commentCountByScope.get('live') ?? 0) > 0 && (
            <CommentBadge count={commentCountByScope.get('live')!} />
          )}
        </button>
        {pr && (
          <button
            type="button"
            data-active={view.kind === 'pr'}
            onClick={pr.onOpen}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left transition-colors ${
              view.kind === 'pr'
                ? 'bg-primary/15 text-primary'
                : 'text-fg-fade-85 hover:bg-[hsl(var(--surface-2)/0.6)]'
            }`}
          >
            <GitPullRequestArrow size={11} strokeWidth={1.8} className="opacity-60 shrink-0" />
            <span className="truncate flex-1 font-mono text-[11.5px]">PR #{pr.number}</span>
            {(pr.threads ?? 0) > 0 && <CommentBadge count={pr.threads!} />}
          </button>
        )}
        {loading && commits.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-fade-40">Loading…</div>
        )}
        {commits.map((c) => {
          const active = activeCommitHash === c.hash;
          return (
            <CommitRow
              key={c.hash}
              commit={c}
              active={active}
              commentCount={commentCountByScope.get(`commit:${c.hash}`) ?? 0}
              onSelect={() => onSelectView({ kind: 'commit', hash: c.hash })}
            />
          );
        })}
      </div>
    </div>
  );
}

interface CommitRowProps {
  commit: CommitSummary;
  active: boolean;
  commentCount: number;
  onSelect: () => void;
}

function CommitRow({ commit, active, commentCount, onSelect }: CommitRowProps) {
  const [hovered, setHovered] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelTimers = () => {
    if (openTimer.current != null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleOpen = () => {
    cancelTimers();
    openTimer.current = window.setTimeout(() => setHovered(true), 220);
  };

  const scheduleClose = () => {
    cancelTimers();
    closeTimer.current = window.setTimeout(() => setHovered(false), 80);
  };

  useEffect(() => cancelTimers, []);

  return (
    <Popover open={hovered}>
      <PopoverAnchor asChild>
        <button
          type="button"
          data-active={active}
          onClick={onSelect}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onFocus={scheduleOpen}
          onBlur={scheduleClose}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left transition-colors ${
            active
              ? 'bg-primary/15 text-primary'
              : 'text-fg-fade-85 hover:bg-[hsl(var(--surface-2)/0.6)]'
          }`}
        >
          <span className="text-[10px] font-mono text-muted-fade-60 tabular-nums shrink-0">
            {commit.shortHash}
          </span>
          <span className="truncate flex-1 font-mono text-[11.5px]">
            {commit.subject || '(no subject)'}
          </span>
          {commentCount > 0 && <CommentBadge count={commentCount} />}
          {(commit.additions > 0 || commit.deletions > 0) && (
            <span className="font-mono text-[10px] flex gap-1 shrink-0 tabular-nums">
              {commit.additions > 0 && (
                <span className="text-[hsl(var(--git-added))]">+{commit.additions}</span>
              )}
              {commit.deletions > 0 && (
                <span className="text-[hsl(var(--git-deleted))]">−{commit.deletions}</span>
              )}
            </span>
          )}
          <span className="text-[10px] text-muted-fade-40 shrink-0 tabular-nums">
            {formatRelativeTime(commit.authorDate, Date.now() / 1000)}
          </span>
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        // Pointer events live so the popover stays open while the cursor is on
        // it; mouseenter/leave on the content cancels the close timer.
        onMouseEnter={() => {
          if (closeTimer.current != null) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
          }
        }}
        onMouseLeave={scheduleClose}
        // Block Radix's auto-focus so the popover doesn't steal focus from the
        // commit list on hover.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-[420px] max-h-[440px] overflow-y-auto p-3.5 flex flex-col gap-2.5"
      >
        <div className="text-[12.5px] font-medium text-foreground leading-snug">
          {commit.subject || '(no subject)'}
        </div>
        {commit.body && (
          <div className="text-[11.5px] text-fg-fade-75 leading-relaxed whitespace-pre-wrap font-mono">
            {commit.body}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1.5 border-t border-border/40 text-[10.5px] text-muted-fade-75">
          <span className="font-mono tabular-nums">{commit.shortHash}</span>
          <span className="opacity-50">·</span>
          <span className="truncate">{commit.authorName}</span>
          <span className="opacity-50">·</span>
          <span className="tabular-nums">
            {formatRelativeTime(commit.authorDate, Date.now() / 1000)}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
