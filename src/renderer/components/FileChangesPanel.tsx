import React, { useState } from 'react';
import {
  Plus,
  Minus,
  Undo2,
  FileText,
  FilePlus,
  FileX,
  FileDiff,
  FileQuestion,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Check,
  Upload,
  PanelRightOpen,
  PanelRightClose,
} from 'lucide-react';
import type { FileChange, FileChangeStatus, GitStatus } from '../../shared/types';

interface FileChangesPanelProps {
  gitStatus: GitStatus | null;
  loading: boolean;
  onStageFile: (filePath: string) => void;
  onUnstageFile: (filePath: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardFile: (filePath: string) => void;
  onViewDiff: (filePath: string, staged: boolean) => void;
  onCommit: (message: string) => Promise<void>;
  onPush: () => Promise<void>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const STATUS_COLORS: Record<FileChangeStatus, string> = {
  modified: 'text-[hsl(var(--git-modified))]',
  added: 'text-[hsl(var(--git-added))]',
  deleted: 'text-[hsl(var(--git-deleted))]',
  renamed: 'text-[hsl(var(--git-renamed))]',
  untracked: 'text-[hsl(var(--git-untracked))]',
  conflicted: 'text-[hsl(var(--git-conflicted))]',
};

const STATUS_BADGE_COLORS: Record<FileChangeStatus, string> = {
  modified: 'bg-[hsl(var(--git-modified)/0.12)] text-[hsl(var(--git-modified))]',
  added: 'bg-[hsl(var(--git-added)/0.12)] text-[hsl(var(--git-added))]',
  deleted: 'bg-[hsl(var(--git-deleted)/0.12)] text-[hsl(var(--git-deleted))]',
  renamed: 'bg-[hsl(var(--git-renamed)/0.12)] text-[hsl(var(--git-renamed))]',
  untracked: 'bg-[hsl(var(--git-untracked)/0.12)] text-[hsl(var(--git-untracked))]',
  conflicted: 'bg-[hsl(var(--git-conflicted)/0.12)] text-[hsl(var(--git-conflicted))]',
};

const STATUS_LABELS: Record<FileChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
};

function StatusIcon({ status }: { status: FileChangeStatus }) {
  const className = `w-3.5 h-3.5 ${STATUS_COLORS[status]}`;
  switch (status) {
    case 'modified':
      return <FileDiff className={className} strokeWidth={1.8} />;
    case 'added':
      return <FilePlus className={className} strokeWidth={1.8} />;
    case 'deleted':
      return <FileX className={className} strokeWidth={1.8} />;
    case 'untracked':
      return <FileQuestion className={className} strokeWidth={1.8} />;
    case 'conflicted':
      return <AlertTriangle className={className} strokeWidth={1.8} />;
    default:
      return <FileText className={className} strokeWidth={1.8} />;
  }
}

function FileItem({
  file,
  onStage,
  onUnstage,
  onDiscard,
  onViewDiff,
}: {
  file: FileChange;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onViewDiff: () => void;
}) {
  const fileName = file.path.split('/').pop() || file.path;
  const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';

  return (
    <div
      className="group flex items-center gap-2 px-2 py-[5px] rounded-md text-[13px] cursor-pointer hover:bg-accent/50 transition-all duration-150"
      onClick={onViewDiff}
    >
      {/* Staged checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          file.staged ? onUnstage() : onStage();
        }}
        className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-colors ${
          file.staged
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-muted-foreground/30 hover:border-muted-foreground/50'
        }`}
        title={file.staged ? 'Unstage' : 'Stage'}
      >
        {file.staged && <Check size={9} strokeWidth={3} />}
      </button>

      <StatusIcon status={file.status} />

      <span className="truncate flex-1 min-w-0" title={file.path}>
        <span className="text-foreground/90">{fileName}</span>
        {dirPath && (
          <span className="text-muted-foreground/40 ml-1">{dirPath}/</span>
        )}
      </span>

      {/* Stat badge */}
      {(file.additions > 0 || file.deletions > 0) && (
        <span className="flex gap-1 text-[10px] font-mono flex-shrink-0 tabular-nums">
          {file.additions > 0 && (
            <span className="text-[hsl(var(--git-added))]">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-[hsl(var(--git-deleted))]">-{file.deletions}</span>
          )}
        </span>
      )}

      {/* Status badge */}
      <span className={`w-[18px] h-[16px] rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${STATUS_BADGE_COLORS[file.status]}`}>
        {STATUS_LABELS[file.status]}
      </span>

      {/* Hover discard action (unstaged only) */}
      {!file.staged && (
        <div className="opacity-0 group-hover:opacity-100 flex gap-px flex-shrink-0 transition-all duration-150">
          <button
            onClick={(e) => { e.stopPropagation(); onDiscard(); }}
            className="p-[3px] rounded hover:bg-destructive/15 text-muted-foreground/50 hover:text-destructive"
            title="Discard changes"
          >
            <Undo2 size={11} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

export function FileChangesPanel({
  gitStatus,
  loading,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onDiscardFile,
  onViewDiff,
  onCommit,
  onPush,
  collapsed,
  onToggleCollapse,
}: FileChangesPanelProps) {
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalChanges = gitStatus?.files.length ?? 0;

  if (collapsed) {
    return (
      <div
        className="h-full flex flex-col items-center py-2 gap-2"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent/60 text-muted-foreground/50 hover:text-foreground transition-colors"
          title="Expand changes panel"
        >
          <PanelRightOpen size={18} strokeWidth={1.5} />
        </button>
        <div className="flex flex-col items-center gap-1">
          <div className="w-8 h-8 rounded-lg bg-accent/40 flex items-center justify-center">
            <FileDiff size={14} className="text-muted-foreground/50" strokeWidth={1.5} />
          </div>
          {totalChanges > 0 && (
            <span className="min-w-[18px] h-[16px] flex items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary tabular-nums px-1">
              {totalChanges}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!gitStatus) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'hsl(var(--surface-1))' }}>
        <p className="text-[11px] text-muted-foreground/40">
          {loading ? 'Loading...' : 'No task selected'}
        </p>
      </div>
    );
  }

  const stagedFiles = gitStatus.files.filter((f) => f.staged);
  const unstagedFiles = gitStatus.files.filter((f) => !f.staged);
  const allStaged = unstagedFiles.length === 0 && stagedFiles.length > 0;
  const noneStaged = stagedFiles.length === 0;

  async function handleCommit() {
    if (!commitMsg.trim() || stagedFiles.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      await onCommit(commitMsg.trim());
      setCommitMsg('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    setError(null);
    try {
      await onPush();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'hsl(var(--surface-1))' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 flex-shrink-0 border-b border-border/60">
        <div className="flex items-center gap-2">
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-[3px] -ml-1 rounded hover:bg-accent text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Collapse changes panel"
            >
              <PanelRightClose size={15} strokeWidth={1.8} />
            </button>
          )}
          <span className="text-[11px] font-semibold uppercase text-muted-foreground/70 tracking-[0.08em]">
            Changes
          </span>
          {totalChanges > 0 && (
            <span className="min-w-[18px] h-[16px] flex items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary tabular-nums px-1">
              {totalChanges}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {gitStatus.branch && (gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <div className="flex items-center gap-1 text-muted-foreground/40 mr-1">
              {gitStatus.ahead > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-[hsl(var(--git-added))]">
                  <ArrowUp size={8} strokeWidth={2.5} />{gitStatus.ahead}
                </span>
              )}
              {gitStatus.behind > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-[hsl(var(--git-deleted))]">
                  <ArrowDown size={8} strokeWidth={2.5} />{gitStatus.behind}
                </span>
              )}
            </div>
          )}
          {!allStaged && unstagedFiles.length > 0 && (
            <button
              onClick={() => onStageAll()}
              className="p-[3px] rounded hover:bg-accent text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Stage all"
            >
              <Plus size={11} strokeWidth={2} />
            </button>
          )}
          {stagedFiles.length > 0 && (
            <button
              onClick={() => onUnstageAll()}
              className="p-[3px] rounded hover:bg-accent text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Unstage all"
            >
              <Minus size={11} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {totalChanges === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent/40 flex items-center justify-center">
              <FileDiff size={14} className="text-muted-foreground/30" strokeWidth={1.5} />
            </div>
            <p className="text-[11px] text-muted-foreground/40">No changes</p>
          </div>
        )}

        {totalChanges > 0 && (
          <div className="px-1 py-1">
            {/* Staged files first, then unstaged */}
            {stagedFiles.map((file) => (
              <FileItem
                key={`staged-${file.path}`}
                file={file}
                onStage={() => {}}
                onUnstage={() => onUnstageFile(file.path)}
                onDiscard={() => {}}
                onViewDiff={() => onViewDiff(file.path, true)}
              />
            ))}
            {unstagedFiles.map((file) => (
              <FileItem
                key={`unstaged-${file.path}`}
                file={file}
                onStage={() => onStageFile(file.path)}
                onUnstage={() => {}}
                onDiscard={() => onDiscardFile(file.path)}
                onViewDiff={() => onViewDiff(file.path, false)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Commit area */}
      {totalChanges > 0 && (
        <div className="flex-shrink-0 border-t border-border/60 p-2 flex flex-col gap-1.5">
          {error && (
            <p className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1 break-words">
              {error}
            </p>
          )}
          <textarea
            value={commitMsg}
            onChange={(e) => { setCommitMsg(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault();
                handleCommit();
              }
            }}
            placeholder={noneStaged ? 'Stage files to commit...' : 'Commit message'}
            disabled={noneStaged}
            rows={2}
            className="w-full text-[12px] bg-background/60 border border-border/60 rounded-md px-2.5 py-1.5 resize-none placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCommit}
              disabled={!commitMsg.trim() || noneStaged || committing}
              className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-[11px] font-medium transition-colors bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Check size={11} strokeWidth={2.5} />
              {committing ? 'Committing...' : 'Commit'}
            </button>
            {gitStatus.ahead > 0 && (
              <button
                onClick={handlePush}
                disabled={pushing}
                className="flex items-center justify-center gap-1.5 h-7 px-3 rounded-md text-[11px] font-medium transition-colors bg-accent hover:bg-accent/80 text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Upload size={10} strokeWidth={2.5} />
                {pushing ? 'Pushing...' : 'Push'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
