import React, { useEffect, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import { ProjectOverview } from './ProjectOverview';
import {
  FolderOpen,
  GitBranch,
  FolderGit2,
  Globe,
  GitPullRequest,
  GitMerge,
  Code2,
} from 'lucide-react';
import type {
  Project,
  Task,
  LinkedItem,
  RemoteControlState,
  ContextUsage,
  PullRequestInfo,
  GitStatus,
} from '../../shared/types';
import { linkedItemUrl, isAdoRemote, branchUrl } from '../../shared/urls';
import { Tooltip } from './ui/Tooltip';

import { formatTokens } from '../../shared/format';
import { UsageBarInline, usageTextColor } from './ui/UsageBar';

function LinkedItemBadges({
  items,
  gitRemote,
  max = 3,
}: {
  items: LinkedItem[];
  gitRemote: string | null;
  max?: number;
}) {
  const visible = items.slice(0, max);
  const overflow = items.length - max;
  return (
    <div className="flex items-center gap-1">
      {visible.map((item) => {
        const url = linkedItemUrl(item, gitRemote);
        const key = `${item.provider}-${item.id}`;
        const badge = url ? (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
          >
            #{item.id}
          </a>
        ) : (
          <span
            key={key}
            className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
          >
            #{item.id}
          </span>
        );
        return item.title ? (
          <Tooltip key={key} content={item.title}>
            {badge}
          </Tooltip>
        ) : (
          badge
        );
      })}
      {overflow > 0 && <span className="text-[10px] text-muted-foreground">+{overflow} more</span>}
    </div>
  );
}

interface MainContentProps {
  activeTask: Task | null;
  activeProject: Project | null;
  sidebarCollapsed?: boolean;
  tasks?: Task[];
  activeTaskId?: string | null;
  taskActivity?: Record<string, import('../../shared/types').ActivityInfo>;
  unseenTaskIds?: Set<string>;
  remoteControlStates?: Record<string, RemoteControlState>;
  contextUsage?: Record<string, ContextUsage>;
  onSelectTask?: (id: string) => void;
  onEnableRemoteControl?: (taskId: string) => void;
  onNewTask?: () => void;
  onProjectSettings?: () => void;
  onShowCommitGraph?: () => void;
  onDeleteProject?: () => void;
  archivedTasks?: Task[];
  onDeleteTask?: (id: string) => void;
  onArchiveTask?: (id: string) => void;
  onRestoreTask?: (id: string) => void;
  gitStatus?: GitStatus | null;
}

export function MainContent({
  activeTask,
  activeProject,
  sidebarCollapsed,
  tasks = [],
  activeTaskId,
  taskActivity = {},
  unseenTaskIds,
  remoteControlStates = {},
  contextUsage = {},
  onSelectTask,
  onEnableRemoteControl,
  onNewTask,
  onProjectSettings,
  onShowCommitGraph,
  onDeleteProject,
  archivedTasks = [],
  onDeleteTask,
  onArchiveTask,
  onRestoreTask,
  gitStatus,
}: MainContentProps) {
  const [prInfo, setPrInfo] = useState<PullRequestInfo | null>(null);

  useEffect(() => {
    setPrInfo(null);

    const liveBranch = gitStatus?.branch;
    const defaultBranch = activeProject?.baseRef || activeProject?.gitBranch || 'main';
    if (!liveBranch || !activeProject || liveBranch === defaultBranch) {
      return;
    }

    let cancelled = false;
    const remote = activeProject.gitRemote;

    async function fetchPr() {
      try {
        let pr: PullRequestInfo | null = null;

        if (remote && isAdoRemote(remote)) {
          const resp = await window.electronAPI.adoGetPrForBranch(
            liveBranch!,
            remote,
            activeProject!.id,
          );
          if (!cancelled && resp.success) pr = resp.data ?? null;
        } else {
          const cwd = activeTask?.path || activeProject!.path;
          const resp = await window.electronAPI.githubGetPrForBranch(cwd, liveBranch!);
          if (!cancelled && resp.success) pr = resp.data ?? null;
        }

        if (!cancelled) setPrInfo(pr);
      } catch {
        if (!cancelled) setPrInfo(null);
      }
    }

    fetchPr();
    const interval = setInterval(fetchPr, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTask?.id, activeProject?.id, activeProject?.gitRemote, gitStatus?.branch]);

  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-accent/60 flex items-center justify-center mx-auto mb-4">
            <FolderOpen size={22} className="text-muted-foreground/40" strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground/80 mb-1.5">Dash</h2>
          <p className="text-[13px] text-muted-foreground/60">Open a folder to get started</p>
        </div>
      </div>
    );
  }

  if (!activeTask) {
    return (
      <ProjectOverview
        project={activeProject}
        tasks={tasks}
        archivedTasks={archivedTasks}
        taskActivity={taskActivity}
        onSelectTask={(id) => onSelectTask?.(id)}
        onNewTask={() => onNewTask?.()}
        onProjectSettings={() => onProjectSettings?.()}
        onShowCommitGraph={() => onShowCommitGraph?.()}
        onDeleteProject={() => onDeleteProject?.()}
        onDeleteTask={(id) => onDeleteTask?.(id)}
        onArchiveTask={(id) => onArchiveTask?.(id)}
        onRestoreTask={(id) => onRestoreTask?.(id)}
      />
    );
  }

  const currentBranch = gitStatus?.branch || activeTask?.branch;
  const currentBranchUrl =
    currentBranch && activeProject?.gitRemote && gitStatus?.hasUpstream
      ? branchUrl(activeProject.gitRemote, currentBranch)
      : null;

  const branchTooltip = gitStatus?.hasUpstream ? 'Branch' : 'Branch (no upstream detected)';
  const BranchIcon = activeTask.useWorktree ? FolderGit2 : GitBranch;

  const branchLabel = currentBranchUrl ? (
    <a
      href={currentBranchUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px] font-mono hover:underline truncate"
    >
      {currentBranch}
    </a>
  ) : (
    <span className="text-[11px] font-mono truncate">{currentBranch}</span>
  );

  const branchBadge = (
    <Tooltip content={branchTooltip}>
      <div className="flex items-center gap-1.5 text-foreground/60 min-w-0 flex-shrink max-w-[180px]">
        <BranchIcon size={11} strokeWidth={2} className="flex-shrink-0" />
        {branchLabel}
      </div>
    </Tooltip>
  );

  const activeCtxRaw = activeTask ? contextUsage[activeTask.id] : undefined;
  const activeCtx = activeCtxRaw && activeCtxRaw.percentage > 0 ? activeCtxRaw : undefined;

  const taskHeader = (
    <div
      className="flex items-center gap-3 px-4 h-10 flex-shrink-0 border-b border-border/60"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {sidebarCollapsed && tasks.length > 0 ? (
        <>
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
            {tasks.map((task, i) => (
              <button
                key={task.id}
                onClick={() => onSelectTask?.(task.id)}
                className={`flex items-center gap-1.5 px-2.5 h-[28px] rounded text-xs whitespace-nowrap flex-shrink-0 transition-colors ${
                  task.id === activeTaskId
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    taskActivity[task.id]?.state === 'error'
                      ? 'bg-destructive'
                      : taskActivity[task.id]?.state === 'waiting'
                        ? 'bg-orange-500'
                        : taskActivity[task.id]?.state === 'busy'
                          ? 'bg-amber-400 animate-pulse'
                          : taskActivity[task.id]?.state === 'idle' && unseenTaskIds?.has(task.id)
                            ? 'bg-blue-400'
                            : taskActivity[task.id]?.state === 'idle'
                              ? 'bg-green-400'
                              : 'bg-muted-foreground/30'
                  }`}
                />
                <span className="truncate max-w-[140px]">{task.name}</span>
                {i < 9 && (
                  <div className="flex items-center gap-[2px] ml-1">
                    <kbd className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-[3px] text-[9px] font-medium leading-none border border-border/80 bg-gradient-to-b from-white/[0.06] to-transparent text-foreground/50 shadow-[0_0.5px_0_0.5px_hsl(var(--border)/0.4),inset_0_0.5px_0_hsl(var(--foreground)/0.04)] font-mono">
                      ⌘
                    </kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-[3px] text-[9px] font-medium leading-none border border-border/80 bg-gradient-to-b from-white/[0.06] to-transparent text-foreground/50 shadow-[0_0.5px_0_0.5px_hsl(var(--border)/0.4),inset_0_0.5px_0_hsl(var(--foreground)/0.04)] font-mono">
                      {i + 1}
                    </kbd>
                  </div>
                )}
              </button>
            ))}
          </div>
          {branchBadge}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-[7px] h-[7px] rounded-full bg-[hsl(var(--git-added))] status-pulse flex-shrink-0" />
            <span className="text-[13px] font-medium text-foreground whitespace-nowrap">
              {activeTask.name}
            </span>
          </div>
          {activeTask.linkedItems && activeTask.linkedItems.length > 0 && (
            <LinkedItemBadges
              items={activeTask.linkedItems}
              gitRemote={activeProject?.gitRemote ?? null}
            />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {/* Context usage indicator */}
            {activeCtx && (
              <div
                className="flex items-center gap-1.5"
                title={`Context: ${activeCtx.used.toLocaleString()} / ${activeCtx.total.toLocaleString()} tokens (${Math.round(activeCtx.percentage)}%)`}
              >
                <UsageBarInline percentage={activeCtx.percentage} />
                <span
                  className={`text-[10px] tabular-nums ${
                    activeCtx.percentage >= 80
                      ? 'text-red-400 font-medium'
                      : usageTextColor(activeCtx.percentage)
                  }`}
                >
                  {formatTokens(activeCtx.used)}/{formatTokens(activeCtx.total)}
                </span>
              </div>
            )}
            {branchBadge}
            {taskActivity[activeTask.id] && (
              <Tooltip content="Remote control">
                <button
                  onClick={() => onEnableRemoteControl?.(activeTask.id)}
                  className={`p-1 rounded-md transition-colors ${
                    remoteControlStates[activeTask.id]
                      ? 'text-primary hover:bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                  }`}
                >
                  <Globe size={14} strokeWidth={1.8} />
                </button>
              </Tooltip>
            )}
            <Tooltip content="Open in IDE">
              <button
                onClick={() => {
                  const stored = localStorage.getItem('preferredIDE');
                  const ide = stored === 'cursor' || stored === 'code' ? stored : undefined;
                  window.electronAPI.openInIDE({ folderPath: activeTask.path, ide });
                }}
                className="p-1 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60"
              >
                <Code2 size={14} strokeWidth={1.8} />
              </button>
            </Tooltip>
            {prInfo && prInfo.state !== 'closed' && (
              <Tooltip content={`${prInfo.title} (${prInfo.state})`}>
                <a
                  href={prInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                    prInfo.state === 'merged'
                      ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20'
                      : 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20'
                  }`}
                >
                  {prInfo.state === 'merged' ? (
                    <GitMerge size={10} strokeWidth={2} />
                  ) : (
                    <GitPullRequest size={10} strokeWidth={2} />
                  )}
                  PR #{prInfo.number}
                </a>
              </Tooltip>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {taskHeader}
      <div className="flex-1 min-h-0">
        <TerminalPane
          key={activeTask.id}
          id={activeTask.id}
          cwd={activeTask.path}
          autoApprove={activeTask.autoApprove}
        />
      </div>
    </div>
  );
}
