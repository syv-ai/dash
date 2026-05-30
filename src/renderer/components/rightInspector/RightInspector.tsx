import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FileChangesPanel } from '../FileChangesPanel';
import { StructuredView } from '../structured/StructuredView';
import { UsageStrip } from './UsageStrip';
import { getStoredTab, setStoredTab, type RightInspectorTab } from './tabStorage';
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
  onCommit,
  onPush,
  onCommitFinished,
  onShowCommitGraph,
  collapsed,
  onToggleCollapse,
}: RightInspectorProps) {
  const taskId = activeTask?.id ?? '__none__';
  const [tab, setTab] = useState<RightInspectorTab>(() => getStoredTab(taskId));

  useEffect(() => {
    setTab(getStoredTab(taskId));
  }, [taskId]);

  const handleTabChange = useCallback(
    (next: RightInspectorTab) => {
      setTab(next);
      setStoredTab(taskId, next);
    },
    [taskId],
  );

  const { adds, dels, fileCount } = useMemo(() => {
    const files = gitStatus?.files ?? [];
    return {
      fileCount: files.length,
      adds: files.reduce((acc, f) => acc + (f.additions ?? 0), 0),
      dels: files.reduce((acc, f) => acc + (f.deletions ?? 0), 0),
    };
  }, [gitStatus?.files]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[hsl(var(--surface-1))]">
      <UsageStrip rateLimits={rateLimits} contextUsage={contextUsage} />

      {/* Tab toggle */}
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <div className="flex-1 relative flex bg-foreground/5 border border-border/60 rounded-md p-[2px]">
          <div
            className="absolute top-[2px] bottom-[2px] w-[calc(50%-2px)] rounded-[4px] bg-foreground/10 shadow-[0_1px_0_hsl(var(--foreground)/0.05)_inset] transition-transform duration-[300ms] ease-[cubic-bezier(0.34,1.4,0.64,1)]"
            style={{ transform: tab === 'structured' ? 'translateX(100%)' : 'translateX(0)' }}
          />
          <button
            onClick={() => handleTabChange('changes')}
            className={`relative z-10 flex-1 text-center text-[11.5px] py-[3px] rounded-[4px] transition-colors ${
              tab === 'changes'
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground font-medium'
            }`}
          >
            Changes
          </button>
          <button
            onClick={() => handleTabChange('structured')}
            className={`relative z-10 flex-1 text-center text-[11.5px] py-[3px] rounded-[4px] transition-colors ${
              tab === 'structured'
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground font-medium'
            }`}
          >
            Structured
          </button>
        </div>
        {fileCount > 0 && (
          <span className="inline-flex items-center font-mono text-[10.5px] tabular-nums">
            <span className="text-[hsl(var(--git-added))]">+{adds}</span>
            <span className="mx-1.5 text-foreground/30">·</span>
            <span className="text-[hsl(var(--git-deleted))]">−{dels}</span>
          </span>
        )}
      </div>

      {/* Tab panes */}
      <div className="flex-1 min-h-0 relative">
        {/* Changes pane */}
        <div
          className={`absolute inset-0 flex flex-col overflow-hidden transition-[opacity,transform] duration-[360ms] ${
            tab === 'changes'
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-[6px] pointer-events-none'
          }`}
        >
          <FileChangesPanel
            key={activeTask?.id ?? '__none__'}
            cwd={activeTask?.path ?? ''}
            gitStatus={gitStatus}
            loading={gitLoading}
            onStageFiles={onStageFiles}
            onUnstageFiles={onUnstageFiles}
            onStageAll={onStageAll}
            onUnstageAll={onUnstageAll}
            onDiscardFiles={onDiscardFiles}
            onAddToGitignore={onAddToGitignore}
            onViewDiff={onViewDiff}
            onCommit={onCommit}
            onPush={onPush}
            onCommitFinished={onCommitFinished}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            onShowCommitGraph={onShowCommitGraph}
            paused={tab !== 'changes'}
          />
        </div>

        {/* Structured pane */}
        <div
          className={`absolute inset-0 overflow-hidden transition-[opacity,transform] duration-[360ms] ${
            tab === 'structured'
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-[6px] pointer-events-none'
          }`}
        >
          {activeTask && (
            <StructuredView
              key={`structured-${activeTask.id}`}
              taskId={activeTask.id}
              taskPath={activeTask.path}
            />
          )}
        </div>
      </div>
    </div>
  );
}
