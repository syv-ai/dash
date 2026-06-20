import React, { useMemo } from 'react';
import { ArrowDown, ArrowUp, GitBranch, Maximize2, Minus, Plus } from 'lucide-react';
import { FileChangesPanel } from '../fileChanges/FileChangesPanel';
import { Tooltip } from '../ui/Tooltip';
import { UsageStrip } from './UsageStrip';
import { useGit } from '../../stores/gitStore';
import type { RateLimits, ContextUsage, Task } from '../../../shared/types';

interface RightInspectorProps {
  activeTask: Task | null;
  rateLimits: RateLimits;
  contextUsage?: ContextUsage;
  onViewDiff: (filePath: string, staged: boolean) => void;
  onCommitFinished?: () => void;
  onShowCommitGraph: () => void;
  /** Open the diff editor on the first changed file. */
  onOpenEditor: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function RightInspector({
  activeTask,
  rateLimits,
  contextUsage,
  onViewDiff,
  onCommitFinished,
  onShowCommitGraph,
  onOpenEditor,
  collapsed,
}: RightInspectorProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const gitLoading = useGit((s) => s.gitLoading);
  const onStageAll = useGit((s) => s.stageAll);
  const onUnstageAll = useGit((s) => s.unstageAll);
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
    <div className="h-full flex flex-col overflow-hidden">
      <UsageStrip rateLimits={rateLimits} contextUsage={contextUsage} />

      {/* Control row */}
      <div className="inspector-controls flex items-center gap-2 px-3 pt-3 pb-1.5">
        {fileCount > 0 && (
          <span className="min-w-[18px] h-[16px] flex items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary tabular-nums px-1 shrink-0">
            {fileCount}
          </span>
        )}
        {fileCount > 0 && (
          <span className="inspector-gitstats inline-flex items-center font-mono text-[10.5px] tabular-nums shrink-0">
            <span className="text-[hsl(var(--git-added))]">+{adds}</span>
            <span className="mx-1.5 text-foreground/30">·</span>
            <span className="text-[hsl(var(--git-deleted))]">−{dels}</span>
          </span>
        )}
        <div className="flex-1" />
        {(showAhead || showBehind) && (
          <div className="inspector-aheadbehind flex items-center gap-1 shrink-0">
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
              onClick={() => {
                void onStageAll();
              }}
              className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Plus size={11} strokeWidth={2} />
            </button>
          </Tooltip>
        )}
        {stagedCount > 0 && (
          <Tooltip content="Unstage all">
            <button
              onClick={() => {
                void onUnstageAll();
              }}
              className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Minus size={11} strokeWidth={2} />
            </button>
          </Tooltip>
        )}
        <Tooltip content={fileCount > 0 ? 'Open in editor' : 'Open editor at latest commit'}>
          <button
            onClick={onOpenEditor}
            className="p-[3px] rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <Maximize2 size={11} strokeWidth={2} />
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <FileChangesPanel
          key={activeTask?.id ?? '__none__'}
          cwd={activeTask?.path ?? ''}
          loading={gitLoading}
          onViewDiff={onViewDiff}
          onCommitFinished={onCommitFinished}
          onShowCommitGraph={onShowCommitGraph}
          collapsed={collapsed}
        />
      </div>
    </div>
  );
}
