import { useMemo, useRef, useState, useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { ChevronDown, ChevronRight, GitCommit, History } from 'lucide-react';
import type { FileChange, FileChangeStatus } from '../../../shared/types';
import type { CommitSummary, EditorView } from './types';

interface EditorSidebarProps {
  /** All file paths in the current view's source (whole repo, sorted). */
  allPaths: string[];
  /** Subset of paths that have a diff for this view, with status + line stats. */
  changedFiles: FileChange[];
  filesLoading: boolean;
  selectedPath: string;
  onSelectFile: (path: string) => void;

  commits: CommitSummary[];
  commitsLoading: boolean;
  /** Whether to surface the "Working tree" pinned entry in the commits drawer. */
  showWorkingTreeRow: boolean;
  view: EditorView;
  onSelectView: (view: EditorView) => void;
}

const COMMITS_DRAWER_KEY = 'diffEditor.commitsDrawerSize';

export function EditorSidebar(props: EditorSidebarProps) {
  const initialDrawerSize = parseInitial(localStorage.getItem(COMMITS_DRAWER_KEY), 35);

  return (
    <div className="h-full min-h-0 flex flex-col rounded-[14px] overflow-hidden right-inspector-shell">
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
          />
        </Panel>
        <PanelResizeHandle className="h-px bg-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--border))] transition-colors" />
        <Panel defaultSize={initialDrawerSize} minSize={10} maxSize={70}>
          <CommitsDrawer
            commits={props.commits}
            loading={props.commitsLoading}
            showWorkingTreeRow={props.showWorkingTreeRow}
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
      const seg = parts[i];
      let child = node.children.get(seg);
      if (!child) {
        const childPath = node.fullPath ? `${node.fullPath}/${seg}` : seg;
        child = newFolder(seg, childPath);
        node.children.set(seg, child);
      }
      node = child;
    }
    node.files.push({
      name: parts[parts.length - 1],
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
}

function FileTreePanel({
  paths,
  changedFiles,
  loading,
  selectedPath,
  onSelectFile,
}: FileTreePanelProps) {
  const tree = useMemo(() => buildRepoTree(paths, changedFiles), [paths, changedFiles]);
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono flex items-center justify-between flex-shrink-0">
        <span>
          Files{' '}
          {tree.changedCount > 0 && (
            <span className="tabular-nums">· {tree.changedCount} changed</span>
          )}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable] pb-2 px-1">
        {loading && paths.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>
        ) : (
          <FolderContents
            node={tree}
            indent={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
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
}

function FolderContents({ node, indent, selectedPath, onSelectFile }: FolderContentsProps) {
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
        />
      ))}
      {childFiles.map((file) => (
        <FileEntry
          key={`f-${file.fullPath}`}
          file={file}
          indent={indent}
          selected={file.fullPath === selectedPath}
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
}: {
  folder: TreeFolder;
  indent: number;
  selectedPath: string;
  onSelectFile: (path: string) => void;
}) {
  // Default-open if any descendant is the current selection or changed.
  const [open, setOpen] = useState<boolean>(() => folder.changedCount > 0);
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
          className="flex-shrink-0 inline-flex items-center justify-center"
          style={{ width: ICON_SLOT }}
        >
          {open ? (
            <ChevronDown size={11} strokeWidth={1.8} className="text-muted-foreground/55" />
          ) : (
            <ChevronRight size={11} strokeWidth={1.8} className="text-muted-foreground/55" />
          )}
        </span>
        <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate text-left ${tint}`}>
          {folder.name}/
        </span>
        {folder.changedCount > 0 && (
          <span
            className={`flex-shrink-0 font-mono text-[10px] font-semibold tabular-nums ${
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
        />
      )}
    </>
  );
}

function FileEntry({
  file,
  indent,
  selected,
  onClick,
}: {
  file: TreeFile;
  indent: number;
  selected: boolean;
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
      <span className="flex-shrink-0" style={{ width: ICON_SLOT }} />
      <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate text-left ${tint}`}>
        {file.name}
      </span>
      {change && (change.additions > 0 || change.deletions > 0) && (
        <span className="font-mono text-[10.5px] flex gap-1.5 flex-shrink-0">
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
          className={`font-mono text-[10px] font-semibold w-3 text-center flex-shrink-0 ${
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
  view: EditorView;
  onSelectView: (view: EditorView) => void;
}

function CommitsDrawer({
  commits,
  loading,
  showWorkingTreeRow,
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
    <div className="h-full min-h-0 flex flex-col bg-[hsl(var(--surface-1)/0.45)]">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono flex items-center gap-1.5 flex-shrink-0">
        <History size={11} strokeWidth={1.8} />
        <span>Commits</span>
        {commits.length > 0 && <span className="ml-auto tabular-nums">{commits.length}</span>}
      </div>
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable] pb-2 px-1"
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
            <GitCommit size={11} strokeWidth={1.8} className="opacity-60 flex-shrink-0" />
            <span className="truncate flex-1 font-mono text-[11.5px]">Working tree</span>
          </button>
        )}
        {loading && commits.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>
        )}
        {commits.map((c) => {
          const active = activeCommitHash === c.hash;
          return (
            <button
              key={c.hash}
              type="button"
              data-active={active}
              onClick={() => onSelectView({ kind: 'commit', hash: c.hash })}
              title={`${c.shortHash}  ${c.authorName}  ${relativeTime(c.authorDate)}`}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left transition-colors ${
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-foreground/85 hover:bg-[hsl(var(--surface-2)/0.6)]'
              }`}
            >
              <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums flex-shrink-0">
                {c.shortHash}
              </span>
              <span className="truncate flex-1 font-mono text-[11.5px]">
                {c.subject || '(no subject)'}
              </span>
              <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 tabular-nums">
                {relativeTime(c.authorDate)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return '';
  const s = Math.floor(Date.now() / 1000 - unixSeconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}
