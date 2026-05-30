import React, { useMemo } from 'react';
import { ArrowDown, ArrowUp, GitBranch, Minus, Plus } from 'lucide-react';
import { FileChangesPanel } from '../FileChangesPanel';
import { Tooltip } from '../ui/Tooltip';
import { UsageStrip } from './UsageStrip';
import type { GitStatus, RateLimits, ContextUsage, Task } from '../../../shared/types';

interface RightInspectorProps {
  activeTask: Task | null;
  gitStatus: GitStatus | null;
  gitLoading: boolean;
  rateLimits: RateLimits;
  contextUsage?: ContextUsage;
  onViewDiff: (filePath: string, staged: boolean) => void;
  onStageFiles: (filePaths: string[]) => void;
  onUnstageFiles: (filePaths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardFiles: (filePaths: string[]) => void;
  onAddToGitignore: (filePath: string) => void;
  onCommit: (message: string) => Promise<void>;
  onPush: () => Promise<void>;
  onCommitFinished?: () => void;
  onShowCommitGraph: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function RightInspector({
  activeTask,
  gitStatus,
  gitLoading,
  rateLimits,
  contextUsage,
  onViewDiff,
  onStageFiles,
  onUnstageFiles,
  onStageAll,
  onUnstageAll,
  onDiscardFiles,
  onAddToGitignore,
  onPush,
  onCommitFinished,
  onShowCommitGraph,
  collapsed,
}: RightInspectorProps) {
  const { adds, dels, fileCount, stagedCount, unstagedCount } = useMemo(() => {
    const files = gitStatus?.files ?? [];
    let stagedCount = 0;
    let unstagedCount = 0;
    for (const f of files) {
      if (f.staged) stagedCount++;
      else unstagedCount++;
    }
    return {
      fileCount: files.length,
      stagedCount,
      unstagedCount,
      adds: files.reduce((acc, f) => acc + (f.additions ?? 0), 0),
      dels: files.reduce((acc, f) => acc + (f.deletions ?? 0), 0),
    };
  }, [gitStatus?.files]);

  const showAhead = !!gitStatus && gitStatus.ahead > 0;
  const showBehind = !!gitStatus && gitStatus.behind > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[hsl(var(--surface-1))]">
      <UsageStrip rateLimits={rateLimits} contextUsage={contextUsage} />

      {/* Control row */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {fileCount > 0 && (
          <span className="min-w-[18px] h-[16px] flex items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary tabular-nums px-1 shrink-0">
            {fileCount}
          </span>
        )}
        {fileCount > 0 && (
          <span className="inline-flex items-center font-mono text-[10.5px] tabular-nums shrink-0">
            <span className="text-[hsl(var(--git-added))]">+{adds}</span>
            <span className="mx-1.5 text-foreground/30">·</span>
            <span className="text-[hsl(var(--git-deleted))]">−{dels}</span>
          </span>
        )}
        <div className="flex-1" />
        {(showAhead || showBehind) && (
          <div className="flex items-center gap-1 shrink-0">
            {showAhead && (
              <span className="flex items-center gap-0.5 text-[9px] text-[hsl(var(--git-added))]">
                <ArrowUp size={8} strokeWidth={2.5} />
                {gitStatus!.ahead}
              </span>
            )}
            {showBehind && (
              <span className="flex items-center gap-0.5 text-[9px] text-[hsl(var(--git-deleted))]">
                <ArrowDown size={8} strokeWidth={2.5} />
                {gitStatus!.behind}
              </span>
            )}
          </div>
        )}
        <Tooltip content="Commit graph">
          <button
            onClick={onShowCommitGraph}
            className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <GitBranch size={11} strokeWidth={2} />
          </button>
        </Tooltip>
        {unstagedCount > 0 && (
          <Tooltip content="Stage all">
            <button
              onClick={onStageAll}
              className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Plus size={11} strokeWidth={2} />
            </button>
          </Tooltip>
        )}
        {stagedCount > 0 && (
          <Tooltip content="Unstage all">
            <button
              onClick={onUnstageAll}
              className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Minus size={11} strokeWidth={2} />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <FileChangesPanel
          key={activeTask?.id ?? '__none__'}
          cwd={activeTask?.path ?? ''}
          gitStatus={gitStatus}
          loading={gitLoading}
          onStageFiles={onStageFiles}
          onUnstageFiles={onUnstageFiles}
          onDiscardFiles={onDiscardFiles}
          onAddToGitignore={onAddToGitignore}
          onViewDiff={onViewDiff}
          onPush={onPush}
          onCommitFinished={onCommitFinished}
          collapsed={collapsed}
        />
      </div>
    </div>
  );
}
