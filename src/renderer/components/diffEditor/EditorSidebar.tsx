import { useMemo, useState } from 'react';
import { buildTree } from '../fileChanges/buildTree';
import type { TreeNode } from '../fileChanges/buildTree';
import { ChevronDown, ChevronRight, FileText, GitCommit, History } from 'lucide-react';
import type { CommitSummary, EditorFile, EditorView } from './types';

interface EditorSidebarProps {
  files: EditorFile[];
  filesLoading: boolean;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;

  commits: CommitSummary[];
  commitsLoading: boolean;
  view: EditorView;
  onSelectView: (view: EditorView) => void;
}

export function EditorSidebar({
  files,
  filesLoading,
  selectedPath,
  onSelectFile,
  commits,
  commitsLoading,
  view,
  onSelectView,
}: EditorSidebarProps) {
  const [drawerOpen, setDrawerOpen] = useState(true);

  return (
    <div className="w-72 flex-shrink-0 flex flex-col border-r border-border/40 bg-[hsl(var(--surface-1))] min-h-0">
      <FileTreePanel
        files={files}
        loading={filesLoading}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
      />
      <CommitsDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        commits={commits}
        loading={commitsLoading}
        view={view}
        onSelectView={onSelectView}
      />
    </div>
  );
}

// ── File tree ────────────────────────────────────────────────

interface FileTreePanelProps {
  files: EditorFile[];
  loading: boolean;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

function FileTreePanel({ files, loading, selectedPath, onSelectFile }: FileTreePanelProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono flex items-center justify-between">
        <span>
          Files {files.length > 0 && <span className="tabular-nums">· {files.length}</span>}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] pb-2">
        {loading && files.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>
        ) : files.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">No changes</div>
        ) : (
          <TreeRows
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

interface TreeRowsProps {
  node: TreeNode;
  indent: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

function TreeRows({ node, indent, selectedPath, onSelectFile }: TreeRowsProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <>
      {Array.from(node.children.values()).map((child) => {
        const isCollapsed = !!collapsed[child.name];
        return (
          <div key={`d-${child.name}`}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [child.name]: !c[child.name] }))}
              className="w-full flex items-center gap-1 px-2 py-1 text-[12px] text-muted-foreground/70 hover:bg-accent/40"
              style={{ paddingLeft: 8 + indent * 12 }}
            >
              {isCollapsed ? (
                <ChevronRight size={11} strokeWidth={1.8} />
              ) : (
                <ChevronDown size={11} strokeWidth={1.8} />
              )}
              <span className="truncate">{child.name}</span>
            </button>
            {!isCollapsed && (
              <TreeRows
                node={child}
                indent={indent + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            )}
          </div>
        );
      })}
      {node.files.map((file) => {
        const isSelected = file.path === selectedPath;
        return (
          <button
            key={`f-${file.path}`}
            type="button"
            onClick={() => onSelectFile(file.path)}
            className={`w-full flex items-center gap-1.5 px-2 py-1 text-[12px] text-left ${
              isSelected ? 'bg-primary/15 text-primary' : 'text-foreground/80 hover:bg-accent/40'
            }`}
            style={{ paddingLeft: 8 + indent * 12 }}
            title={file.path}
          >
            <FileText size={11} strokeWidth={1.8} className="flex-shrink-0 opacity-60" />
            <span className="truncate flex-1">{basename(file.path)}</span>
            {(file.additions > 0 || file.deletions > 0) && (
              <span className="text-[10px] font-mono tabular-nums flex-shrink-0">
                {file.additions > 0 && (
                  <span className="text-[hsl(var(--git-added))]">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-[hsl(var(--git-deleted))] ml-0.5">-{file.deletions}</span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

// ── Commits drawer ───────────────────────────────────────────

interface CommitsDrawerProps {
  open: boolean;
  onToggle: () => void;
  commits: CommitSummary[];
  loading: boolean;
  view: EditorView;
  onSelectView: (view: EditorView) => void;
}

function CommitsDrawer({
  open,
  onToggle,
  commits,
  loading,
  view,
  onSelectView,
}: CommitsDrawerProps) {
  const workingActive = view.kind === 'working';
  const activeCommitHash = view.kind === 'commit' ? view.hash : null;

  return (
    <div className="flex-shrink-0 border-t border-border/40 bg-[hsl(var(--surface-2))]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown size={11} strokeWidth={1.8} />
        ) : (
          <ChevronRight size={11} strokeWidth={1.8} />
        )}
        <History size={11} strokeWidth={1.8} />
        <span>Commits</span>
        {commits.length > 0 && <span className="ml-auto tabular-nums">{commits.length}</span>}
      </button>
      {open && (
        <div className="max-h-60 overflow-y-auto [scrollbar-gutter:stable] py-1">
          <button
            type="button"
            onClick={() => onSelectView({ kind: 'working', ref: 'HEAD' })}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left ${
              workingActive ? 'bg-primary/15 text-primary' : 'text-foreground/80 hover:bg-accent/40'
            }`}
          >
            <GitCommit size={11} strokeWidth={1.8} className="opacity-60" />
            <span className="truncate flex-1">Working tree</span>
          </button>
          {loading && commits.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>
          )}
          {commits.map((c) => {
            const active = activeCommitHash === c.hash;
            return (
              <button
                key={c.hash}
                type="button"
                onClick={() => onSelectView({ kind: 'commit', hash: c.hash })}
                title={`${c.shortHash}  ${c.authorName}  ${relativeTime(c.authorDate)}`}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left ${
                  active ? 'bg-primary/15 text-primary' : 'text-foreground/80 hover:bg-accent/40'
                }`}
              >
                <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums flex-shrink-0">
                  {c.shortHash}
                </span>
                <span className="truncate flex-1">{c.subject || '(no subject)'}</span>
                <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 tabular-nums">
                  {relativeTime(c.authorDate)}
                </span>
              </button>
            );
          })}
        </div>
      )}
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
