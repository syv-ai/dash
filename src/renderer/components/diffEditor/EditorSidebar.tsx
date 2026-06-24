import { useMemo, useRef, useState, useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { ChevronDown, ChevronRight, GitCommit, History } from 'lucide-react';
import type { FileChange, FileChangeStatus } from '../../../shared/types';
import { formatRelativeTime } from '@shared/relativeTime';
import type { CommitSummary, EditorView } from './types';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';

interface EditorSidebarProps {
  /** All file paths in the current view's source (whole repo, sorted). */
  allPaths: string[];
  /** Subset of paths that have a diff for this view, with status + line stats. */
  changedFiles: FileChange[];
  filesLoading: boolean;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  /** Per-file comment counts. Files in this map get a small badge in the
   *  tree; folders aggregate their descendants' counts for the same badge. */
  commentCounts: Map<string, number>;

  commits: CommitSummary[];
  commitsLoading: boolean;
  /** Whether to surface the "Working tree" pinned entry in the commits drawer. */
  showWorkingTreeRow: boolean;
  /** Comment count per scope ('live' / 'commit:<hash>') → badge on each row. */
  commentCountByScope: Map<string, number>;
  view: EditorView;
  onSelectView: (view: EditorView) => void;
}

const COMMITS_DRAWER_KEY = 'diffEditor.commitsDrawerSize';

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
            paths={props.allPaths}
            changedFiles={props.changedFiles}
            loading={props.filesLoading}
            selectedPath={props.selectedPath}
            onSelectFile={props.onSelectFile}
            commentCounts={props.commentCounts}
          />
        </Panel>
        <PanelResizeHandle className="h-px bg-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--border))] transition-colors" />
        <Panel defaultSize={initialDrawerSize} minSize={10} maxSize={70}>
          <CommitsDrawer
            commits={props.commits}
            loading={props.commitsLoading}
            showWorkingTreeRow={props.showWorkingTreeRow}
            commentCountByScope={props.commentCountByScope}
            view={props.view}
            onSelectView={props.onSelectView}
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

function buildRepoTree(paths: string[], changedFiles: FileChange[]): TreeFolder {
  const changedByPath = new Map<string, FileChange>();
  for (const f of changedFiles) changedByPath.set(f.path, f);

  // Use the union of repo paths and changed paths (e.g. deleted files may not
  // be in `paths` for the working view but are still in changedFiles).
  const all = new Set<string>(paths);
  for (const f of changedFiles) all.add(f.path);

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
    node.files.push({
      name: parts[parts.length - 1]!,
      fullPath: p,
      change: changedByPath.get(p) ?? null,
    });
  }

  function aggregate(node: TreeFolder) {
    const statuses = new Set<FileChangeStatus>();
    let changed = 0;
    for (const file of node.files) {
      if (file.change) {
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
};

const STATUS_TEXT: Record<FileChangeStatus, string> = {
  modified: 'text-[hsl(var(--git-modified))]',
  added: 'text-[hsl(var(--git-added))]',
  deleted: 'text-[hsl(var(--git-deleted))]',
  renamed: 'text-[hsl(var(--git-renamed))]',
  untracked: 'text-[hsl(var(--git-untracked))]',
  conflicted: 'text-[hsl(var(--git-conflicted))]',
};

const FOLDER_TINT: Record<FileChangeStatus, string> = {
  modified: 'text-[hsl(var(--git-modified)/0.85)]',
  added: 'text-[hsl(var(--git-added)/0.85)]',
  deleted: 'text-[hsl(var(--git-deleted)/0.85)]',
  renamed: 'text-[hsl(var(--git-renamed)/0.85)]',
  untracked: 'text-[hsl(var(--git-untracked))]',
  conflicted: 'text-[hsl(var(--git-conflicted)/0.85)]',
};

interface FileTreePanelProps {
  paths: string[];
  changedFiles: FileChange[];
  loading: boolean;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  commentCounts: Map<string, number>;
}

function FileTreePanel({
  paths,
  changedFiles,
  loading,
  selectedPath,
  onSelectFile,
  commentCounts,
}: FileTreePanelProps) {
  const tree = useMemo(() => buildRepoTree(paths, changedFiles), [paths, changedFiles]);
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono flex items-center justify-between shrink-0">
        <span>
          Files{' '}
          {tree.changedCount > 0 && (
            <span className="tabular-nums">· {tree.changedCount} changed</span>
          )}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable scrollbar-thin-hover pb-2 px-1">
        {loading && paths.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>
        ) : (
          <FolderContents
            node={tree}
            indent={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            commentCounts={commentCounts}
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
  commentCounts: Map<string, number>;
}

function FolderContents({
  node,
  indent,
  selectedPath,
  onSelectFile,
  commentCounts,
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
          commentCounts={commentCounts}
        />
      ))}
      {childFiles.map((file) => (
        <FileEntry
          key={`f-${file.fullPath}`}
          file={file}
          indent={indent}
          selected={file.fullPath === selectedPath}
          commentCount={commentCounts.get(file.fullPath) ?? 0}
          onClick={() => onSelectFile(file.fullPath)}
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
  commentCounts,
}: {
  folder: TreeFolder;
  indent: number;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  commentCounts: Map<string, number>;
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
  const tint = folder.dominantStatus ? FOLDER_TINT[folder.dominantStatus] : 'text-foreground/90';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full group flex items-center gap-1 py-0.5 rounded-md text-[12px] hover:bg-[hsl(var(--surface-2)/0.6)] transition-colors"
        style={{ paddingLeft: 4 + indent * INDENT_STEP, paddingRight: 8 }}
      >
        <span
          className="shrink-0 inline-flex items-center justify-center"
          style={{ width: ICON_SLOT }}
        >
          {open ? (
            <ChevronDown size={11} strokeWidth={1.8} className="text-muted-foreground/55" />
          ) : (
            <ChevronRight size={11} strokeWidth={1.8} className="text-muted-foreground/55" />
          )}
        </span>
        <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate text-left ${tint}`}>
          {folder.name}
          <span className="text-muted-foreground/40">/</span>
        </span>
        {folder.changedCount > 0 && (
          <span
            className={`shrink-0 font-mono text-[10px] font-semibold tabular-nums ${
              folder.dominantStatus
                ? STATUS_TEXT[folder.dominantStatus]
                : 'text-muted-foreground/70'
            }`}
            aria-label={`${folder.changedCount} changed`}
          >
            {folder.changedCount}
          </span>
        )}
      </button>
      {open && (
        <FolderContents
          node={folder}
          indent={indent + 1}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          commentCounts={commentCounts}
        />
      )}
    </>
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
  commentCount,
  onClick,
}: {
  file: TreeFile;
  indent: number;
  selected: boolean;
  commentCount: number;
  onClick: () => void;
}) {
  const change = file.change;
  const tint = selected
    ? 'text-primary'
    : change
      ? STATUS_TEXT[change.status]
      : 'text-foreground/80';
  return (
    <button
      type="button"
      onClick={onClick}
      title={file.fullPath}
      style={{ paddingLeft: 4 + indent * INDENT_STEP, paddingRight: 8 }}
      className={`w-full group flex items-center gap-1 py-0.5 rounded-md text-[12px] transition-colors ${
        selected ? 'bg-primary/15' : 'hover:bg-[hsl(var(--surface-2)/0.6)]'
      }`}
    >
      {/* Empty icon slot keeps file names aligned with folder names at the
          same indent (the chevron column for folders). */}
      <span className="shrink-0" style={{ width: ICON_SLOT }} />
      <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate text-left ${tint}`}>
        {file.name}
      </span>
      {commentCount > 0 && <CommentBadge count={commentCount} />}
      {change && (change.additions > 0 || change.deletions > 0) && (
        <span className="font-mono text-[10.5px] flex gap-1.5 shrink-0">
          {change.additions > 0 && (
            <span
              className={
                change.status === 'untracked'
                  ? 'text-muted-foreground'
                  : 'text-[hsl(var(--git-added))]'
              }
            >
              +{change.additions}
            </span>
          )}
          {change.deletions > 0 && (
            <span className="text-[hsl(var(--git-deleted))]">−{change.deletions}</span>
          )}
        </span>
      )}
      {change && (
        <span
          className={`font-mono text-[10px] font-semibold w-3 text-center shrink-0 ${
            selected ? 'text-primary' : STATUS_TEXT[change.status]
          }`}
        >
          {STATUS_LABEL[change.status]}
        </span>
      )}
    </button>
  );
}

// ── Commits drawer ───────────────────────────────────────────

interface CommitsDrawerProps {
  commits: CommitSummary[];
  loading: boolean;
  showWorkingTreeRow: boolean;
  commentCountByScope: Map<string, number>;
  view: EditorView;
  onSelectView: (view: EditorView) => void;
}

function CommitsDrawer({
  commits,
  loading,
  showWorkingTreeRow,
  commentCountByScope,
  view,
  onSelectView,
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
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono flex items-center gap-1.5 shrink-0">
        <History size={11} strokeWidth={1.8} />
        <span>Commits</span>
        {commits.length > 0 && <span className="ml-auto tabular-nums">{commits.length}</span>}
      </div>
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable scrollbar-thin-hover pb-2 px-1"
      >
        {showWorkingTreeRow && (
          <button
            type="button"
            data-active={workingActive}
            onClick={() => onSelectView({ kind: 'working', ref: 'HEAD' })}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left transition-colors ${
              workingActive
                ? 'bg-primary/15 text-primary'
                : 'text-foreground/85 hover:bg-[hsl(var(--surface-2)/0.6)]'
            }`}
          >
            <GitCommit size={11} strokeWidth={1.8} className="opacity-60 shrink-0" />
            <span className="truncate flex-1 font-mono text-[11.5px]">Working tree</span>
            {(commentCountByScope.get('live') ?? 0) > 0 && (
              <CommentBadge count={commentCountByScope.get('live')!} />
            )}
          </button>
        )}
        {loading && commits.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>
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
              : 'text-foreground/85 hover:bg-[hsl(var(--surface-2)/0.6)]'
          }`}
        >
          <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums shrink-0">
            {commit.shortHash}
          </span>
          <span className="truncate flex-1 font-mono text-[11.5px]">
            {commit.subject || '(no subject)'}
          </span>
          {commentCount > 0 && <CommentBadge count={commentCount} />}
          <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">
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
          <div className="text-[11.5px] text-foreground/75 leading-relaxed whitespace-pre-wrap font-mono">
            {commit.body}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1.5 border-t border-border/40 text-[10.5px] text-muted-foreground/75">
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
