import React, { useState, useRef, useEffect } from 'react';
import { Tooltip } from './ui/Tooltip';
import { Popover, PopoverTrigger, PopoverContent, PopoverArrow } from './ui/Popover';
import { CircleCheck } from './ui/CircleCheck';
import { FileTreeView } from './fileChanges/FileTreeView';
import {
  commitRunReducer,
  initialRunningState,
  type CommitRunState,
  type CommitRunEvent,
} from './fileChanges/commitRunReducer';
import { CommitRunView } from './fileChanges/CommitRunView';
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
  GitBranch,
  X,
} from 'lucide-react';
import type { FileChange, FileChangeStatus, GitStatus } from '../../shared/types';

interface FileChangesPanelProps {
  cwd: string;
  gitStatus: GitStatus | null;
  loading: boolean;
  onStageFiles: (filePaths: string[]) => void;
  onUnstageFiles: (filePaths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardFiles: (filePaths: string[]) => void;
  onAddToGitignore: (filePath: string) => void;
  onViewDiff: (filePath: string, staged: boolean) => void;
  onCommit: (message: string, options?: { allowEmpty?: boolean }) => Promise<void>;
  onPush: () => Promise<void>;
  onCommitFinished?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onShowCommitGraph?: () => void;
  /** When true, force-close transient surfaces (commit popover). Used by the
   *  RightInspector when switching to the Structured tab. */
  paused?: boolean;
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
  isNew,
  onStage,
  onUnstage,
  onDiscard,
  onViewDiff,
}: {
  file: FileChange;
  isNew?: boolean;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onViewDiff: () => void;
}) {
  const fileName = file.path.split(/[\\/]/).pop() || file.path;
  const lastSep = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'));
  const dirPath = lastSep > -1 ? file.path.substring(0, lastSep) : '';

  return (
    <div
      className={`group relative flex items-center gap-2 px-2 py-[5px] rounded-md text-[13px] cursor-pointer hover:bg-accent/50 transition-all duration-150 ${isNew ? 'file-item-enter' : ''}`}
      onClick={onViewDiff}
    >
      {/* Staged checkbox */}
      <Tooltip content={file.staged ? 'Unstage' : 'Stage'}>
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
        >
          {file.staged && <Check size={9} strokeWidth={3} />}
        </button>
      </Tooltip>

      <StatusIcon status={file.status} />

      <Tooltip content={file.path}>
        <span className="truncate flex-1 min-w-0">
          <span className="text-foreground/90">{fileName}</span>
          {dirPath && <span className="text-muted-foreground/40 ml-1">{dirPath}/</span>}
        </span>
      </Tooltip>

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

      {/* Status badge — hidden (but width preserved) on hover when discard will overlay it */}
      <span
        className={`w-[18px] h-[16px] rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${STATUS_BADGE_COLORS[file.status]} ${
          !file.staged ? 'group-hover:invisible' : ''
        }`}
      >
        {STATUS_LABELS[file.status]}
      </span>

      {/* Hover discard action (unstaged only) — overlays the status badge slot */}
      {!file.staged && (
        <Tooltip content="Discard changes">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            className="hidden group-hover:flex absolute right-2 top-1/2 -translate-y-1/2 p-[3px] rounded hover:bg-destructive/15 text-muted-foreground/50 hover:text-destructive"
          >
            <Undo2 size={11} strokeWidth={2} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function FileChangesPanel({
  cwd,
  gitStatus,
  loading,
  onStageFiles,
  onUnstageFiles,
  onStageAll,
  onUnstageAll,
  onDiscardFiles,
  onAddToGitignore,
  onViewDiff,
  onCommit,
  onPush,
  onCommitFinished,
  collapsed,
  onToggleCollapse,
  onShowCommitGraph,
  paused = false,
}: FileChangesPanelProps) {
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [allowEmpty, setAllowEmpty] = useState(false);
  const commitTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [commitRun, setCommitRun] = useState<CommitRunState>({ status: 'idle' });
  const prevStagedRef = useRef<string[]>([]);
  const lastMessageRef = useRef('');
  const lastAllowEmptyRef = useRef(false);

  useEffect(() => {
    if (commitOpen) {
      const id = setTimeout(() => commitTextareaRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [commitOpen]);

  // Subscribe to commit events while running. The reducer ignores events
  // once we've left the running state.
  useEffect(() => {
    if (commitRun.status !== 'running') return;
    const runningRequestId = commitRun.requestId;
    const off = window.electronAPI.onCommitEvent((msg) => {
      if (msg.requestId !== runningRequestId) return;
      setCommitRun((s) =>
        s.status === 'running' ? commitRunReducer(s, msg.event as CommitRunEvent) : s,
      );
    });
    return off;
  }, [commitRun.status, commitRun.status === 'running' ? commitRun.requestId : null]);

  // After success: refresh status (parent will swap files into the tree),
  // then linger briefly before returning the panel to the idle tree view.
  useEffect(() => {
    if (commitRun.status !== 'success') return;
    onCommitFinished?.();
    const id = setTimeout(() => setCommitRun({ status: 'idle' }), 600);
    return () => clearTimeout(id);
  }, [commitRun.status, onCommitFinished]);

  // Close the commit popover when the parent signals a major focus shift —
  // tab change to Structured, panel collapse, etc.
  useEffect(() => {
    if (paused) setCommitOpen(false);
  }, [paused]);

  // Track previous file keys to detect newly added files
  const prevFileKeysRef = useRef<Set<string>>(new Set());
  const newFileKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!gitStatus) return;
    const currentKeys = new Set(gitStatus.files.map((f) => `${f.staged ? 's' : 'u'}-${f.path}`));
    const newKeys = new Set<string>();
    // Only mark files as new if we had a previous set (skip initial render)
    if (prevFileKeysRef.current.size > 0) {
      for (const key of currentKeys) {
        if (!prevFileKeysRef.current.has(key)) {
          newKeys.add(key);
        }
      }
    }
    newFileKeysRef.current = newKeys;
    prevFileKeysRef.current = currentKeys;
  }, [gitStatus?.files]);

  const totalChanges = gitStatus?.files.length ?? 0;

  if (collapsed) {
    return (
      <div
        className="h-full flex flex-col items-center py-3 gap-2"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <div className="flex flex-col items-center gap-1">
          <div className="w-8 h-8 rounded-lg bg-accent/40 flex items-center justify-center">
            <FileDiff size={14} className="text-muted-foreground" strokeWidth={1.5} />
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
      <div
        className="h-full flex items-center justify-center"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <p className="text-[11px] text-muted-foreground/40">
          {loading ? 'Loading...' : 'No task selected'}
        </p>
      </div>
    );
  }

  const stagedFiles = gitStatus?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = gitStatus?.files.filter((f) => !f.staged) ?? [];
  const allStaged = unstagedFiles.length === 0 && stagedFiles.length > 0;
  const noneStaged = stagedFiles.length === 0;
  const totalAdds = stagedFiles.reduce((acc, f) => acc + (f.additions ?? 0), 0);
  const totalDels = stagedFiles.reduce((acc, f) => acc + (f.deletions ?? 0), 0);

  // Files that were staged before this commit and are now unstaged — those are
  // the auto-fixes a hook applied. Only meaningful in the `failed` state.
  const autoFixPaths = (() => {
    if (commitRun.status !== 'failed' || !gitStatus) return [] as string[];
    const nowUnstaged = new Set(gitStatus.files.filter((f) => !f.staged).map((f) => f.path));
    return prevStagedRef.current.filter((p) => nowUnstaged.has(p));
  })();
  const showingRunView =
    commitRun.status === 'running' ||
    commitRun.status === 'failed' ||
    commitRun.status === 'cancelled';

  async function handleCommit() {
    if (!commitMsg.trim() || stagedFiles.length === 0) return;
    setCommitting(true);
    setError(null);
    const trimmed = commitMsg.trim();
    prevStagedRef.current = stagedFiles.map((f) => f.path);
    lastMessageRef.current = trimmed;
    lastAllowEmptyRef.current = allowEmpty;
    try {
      const res = await window.electronAPI.gitCommitStart({
        cwd,
        message: trimmed,
        allowEmpty,
      });
      if (!res.success || !res.data) throw new Error(res.error || 'Commit failed');
      setCommitRun(initialRunningState(res.data.requestId));
      setCommitMsg('');
      setAllowEmpty(false);
      setCommitOpen(false);
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
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 flex-shrink-0 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold uppercase text-foreground/80 tracking-[0.08em]">
            Changes
          </span>
          {totalChanges > 0 && (
            <span className="min-w-[18px] h-[16px] flex items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary tabular-nums px-1">
              {totalChanges}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onShowCommitGraph && (
            <Tooltip content="Commit graph">
              <button
                onClick={onShowCommitGraph}
                className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <GitBranch size={11} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
          {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <div className="flex items-center gap-1 text-muted-foreground/40 mr-1">
              {gitStatus.ahead > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-[hsl(var(--git-added))]">
                  <ArrowUp size={8} strokeWidth={2.5} />
                  {gitStatus.ahead}
                </span>
              )}
              {gitStatus.behind > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-[hsl(var(--git-deleted))]">
                  <ArrowDown size={8} strokeWidth={2.5} />
                  {gitStatus.behind}
                </span>
              )}
            </div>
          )}
          {!allStaged && unstagedFiles.length > 0 && (
            <Tooltip content="Stage all">
              <button
                onClick={() => onStageAll()}
                className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus size={11} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
          {stagedFiles.length > 0 && (
            <Tooltip content="Unstage all">
              <button
                onClick={() => onUnstageAll()}
                className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Minus size={11} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {showingRunView ? (
        <div key="run" className="flex-1 min-h-0 flex flex-col animate-fade-in">
          <CommitRunView
            state={commitRun as Exclude<CommitRunState, { status: 'idle' } | { status: 'success' }>}
            autoFixCount={autoFixPaths.length}
            onCancel={() => {
              if (commitRun.status === 'running') {
                window.electronAPI.gitCommitCancel(commitRun.requestId);
              }
            }}
            onBackToFiles={() => setCommitRun({ status: 'idle' })}
            onStageFixesAndRetry={async () => {
              await window.electronAPI.gitStageFiles({ cwd, filePaths: autoFixPaths });
              prevStagedRef.current = [...new Set([...prevStagedRef.current, ...autoFixPaths])];
              const res = await window.electronAPI.gitCommitStart({
                cwd,
                message: lastMessageRef.current,
                allowEmpty: lastAllowEmptyRef.current,
              });
              if (!res.success || !res.data) {
                setError(res.error || 'Retry failed');
                setCommitRun({ status: 'idle' });
                return;
              }
              setCommitRun(initialRunningState(res.data.requestId));
            }}
          />
        </div>
      ) : (
        <div key="changes" className="flex-1 min-h-0 flex flex-col animate-fade-in">
          {/* File list */}
          <div className="flex-1 overflow-y-auto">
            {totalChanges === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <div className="w-8 h-8 rounded-xl bg-accent/40 flex items-center justify-center">
                  <FileDiff size={14} className="text-foreground/50" strokeWidth={1.5} />
                </div>
                <p className="text-[11px] text-foreground/60">No changes</p>
                {gitStatus && gitStatus.ahead > 0 && (
                  <p className="text-[10px] text-muted-foreground/40">
                    {gitStatus.ahead} commit{gitStatus.ahead !== 1 ? 's' : ''} ahead
                  </p>
                )}
              </div>
            )}

            {totalChanges > 0 && (
              <div className="py-1">
                {stagedFiles.length > 0 && (
                  <div className="flex flex-col">
                    <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Staged · {stagedFiles.length}
                    </div>
                    <FileTreeView
                      files={stagedFiles}
                      onToggleFileStage={(f) => onUnstageFiles([f.path])}
                      onToggleFolderStage={onUnstageFiles}
                      onViewDiff={(f) => onViewDiff(f.path, true)}
                      onDiscard={(f) => onDiscardFiles([f.path])}
                      onDiscardMany={onDiscardFiles}
                      onAddToGitignore={onAddToGitignore}
                    />
                  </div>
                )}
                {unstagedFiles.length > 0 && (
                  <div className="flex flex-col">
                    <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Unstaged · {unstagedFiles.length}
                    </div>
                    <FileTreeView
                      files={unstagedFiles}
                      onToggleFileStage={(f) => onStageFiles([f.path])}
                      onToggleFolderStage={onStageFiles}
                      onViewDiff={(f) => onViewDiff(f.path, false)}
                      onDiscard={(f) => onDiscardFiles([f.path])}
                      onDiscardMany={onDiscardFiles}
                      onAddToGitignore={onAddToGitignore}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Commit area — always rendered to preserve textarea focus & state across git refreshes */}
          {stagedFiles.length > 0 && (
            <div className="flex-shrink-0 border-t border-border/60 p-2">
              <Popover
                open={commitOpen}
                onOpenChange={(open) => {
                  setCommitOpen(open);
                  if (!open) setError(null);
                }}
              >
                <Tooltip content="Commit staged changes">
                  <PopoverTrigger asChild>
                    <button className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md text-[12px] font-medium transition-colors bg-primary/15 text-primary hover:bg-primary/25">
                      <Check size={12} strokeWidth={2.5} />
                      Commit
                      <span className="text-primary/70 font-normal tabular-nums">
                        {stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'}
                      </span>
                    </button>
                  </PopoverTrigger>
                </Tooltip>

                <PopoverContent
                  side="left"
                  align="end"
                  sideOffset={12}
                  onInteractOutside={(e) => e.preventDefault()}
                  className="w-[400px] h-[440px] p-3.5 flex flex-col gap-2.5"
                >
                  <div className="flex items-baseline justify-between flex-shrink-0">
                    <h4 className="text-[12px] font-semibold text-foreground tracking-tight">
                      Commit{' '}
                      <span className="text-primary tabular-nums">
                        {stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'}
                      </span>
                    </h4>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      <span className="text-[hsl(var(--git-added))]">+{totalAdds}</span>
                      <span className="mx-1 text-foreground/20">·</span>
                      <span className="text-[hsl(var(--git-deleted))]">−{totalDels}</span>
                    </span>
                  </div>
                  {error && (
                    <div className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1.5 flex items-start gap-1.5 flex-shrink-0">
                      <span className="break-words flex-1 min-w-0">{error}</span>
                      <button
                        onClick={() => setError(null)}
                        aria-label="Dismiss error"
                        className="flex-shrink-0 -mr-0.5 -mt-0.5 p-0.5 rounded hover:bg-destructive/20 transition-colors"
                      >
                        <X size={11} strokeWidth={2.5} />
                      </button>
                    </div>
                  )}
                  <textarea
                    ref={commitTextareaRef}
                    value={commitMsg}
                    onChange={(e) => {
                      setCommitMsg(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Escape') e.stopPropagation();
                      if (e.key === 'Enter' && e.metaKey) {
                        e.preventDefault();
                        handleCommit();
                      }
                    }}
                    placeholder="Describe the change…"
                    className="flex-1 min-h-0 w-full text-[12.5px] leading-relaxed bg-background/60 border border-border/60 rounded-md px-3 py-2 resize-none placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                  />
                  <CircleCheck
                    checked={allowEmpty}
                    onChange={setAllowEmpty}
                    label={
                      <span className="flex items-center gap-1.5">
                        Allow empty commit
                        <Tooltip content="Pass --allow-empty to git. Useful for marker / sync commits.">
                          <span className="text-[10px] text-muted-foreground/40 cursor-help">
                            ⓘ
                          </span>
                        </Tooltip>
                      </span>
                    }
                    className="flex-shrink-0"
                  />
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10.5px] text-muted-foreground/70 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-foreground/5 text-foreground/70">
                        ⌘
                      </kbd>
                      <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-foreground/5 text-foreground/70 ml-1">
                        ↵
                      </kbd>
                      <span className="ml-1.5">to commit</span>
                    </span>
                    <div className="flex gap-1.5 ml-auto">
                      {gitStatus && gitStatus.ahead > 0 && (
                        <button
                          onClick={handlePush}
                          disabled={pushing}
                          className="flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium transition-colors bg-accent hover:bg-accent/80 text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Upload size={11} strokeWidth={2.5} />
                          {pushing ? 'Pushing…' : `Push ${gitStatus.ahead}`}
                        </button>
                      )}
                      <button
                        onClick={handleCommit}
                        disabled={!commitMsg.trim() || committing}
                        className="flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[11.5px] font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Check size={11} strokeWidth={2.5} />
                        {committing ? 'Committing…' : 'Commit'}
                      </button>
                    </div>
                  </div>
                  <PopoverArrow />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
