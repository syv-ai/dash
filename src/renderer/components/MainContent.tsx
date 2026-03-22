import React, { useEffect, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import { ProjectOverview } from './ProjectOverview';
import { FolderOpen, GitBranch, FolderGit2, Globe, GitPullRequest, Code2 } from 'lucide-react';
import type {
  Project,
  Task,
  RemoteControlState,
  PullRequestInfo,
  GitStatus,
} from '../../shared/types';
import { linkedItemUrl, isAdoRemote, branchUrl } from '../../shared/urls';
import { Tooltip } from './ui/Tooltip';

interface MainContentProps {
  activeTask: Task | null;
  activeProject: Project | null;
  sidebarCollapsed?: boolean;
  tasks?: Task[];
  activeTaskId?: string | null;
  taskActivity?: Record<string, 'busy' | 'idle' | 'waiting'>;
  unseenTaskIds?: Set<string>;
  remoteControlStates?: Record<string, RemoteControlState>;
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

    (async () => {
      try {
        let pr: PullRequestInfo | null = null;

        if (remote && isAdoRemote(remote)) {
          const resp = await window.electronAPI.adoGetPrForBranch(
            liveBranch,
            remote,
            activeProject.id,
          );
          if (!cancelled && resp.success) pr = resp.data ?? null;
        } else {
          const cwd = activeTask?.path || activeProject.path;
          const resp = await window.electronAPI.githubGetPrForBranch(cwd, liveBranch);
          if (!cancelled && resp.success) pr = resp.data ?? null;
        }

        if (!cancelled) setPrInfo(pr);
      } catch {
        if (!cancelled) setPrInfo(null);
      }
    })();

    return () => {
      cancelled = true;
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
                    taskActivity[task.id] === 'waiting'
                      ? 'bg-orange-500'
                      : taskActivity[task.id] === 'busy'
                        ? 'bg-amber-400 animate-pulse'
                        : taskActivity[task.id] === 'idle' && unseenTaskIds?.has(task.id)
                          ? 'bg-blue-400'
                          : taskActivity[task.id] === 'idle'
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
          {activeTask.useWorktree && (
            <Tooltip content="Worktree">
              <div className="flex items-center gap-1.5 text-foreground/60 min-w-0 flex-shrink max-w-[180px]">
                <FolderGit2 size={11} strokeWidth={2} className="flex-shrink-0" />
                <span className="text-[11px] font-mono truncate">
                  {activeTask.path.split('/').pop()}
                </span>
              </div>
            </Tooltip>
          )}
          <Tooltip content={branchTooltip}>
            <div className="flex items-center gap-1.5 text-foreground/60 min-w-0 flex-shrink max-w-[180px]">
              <GitBranch size={11} strokeWidth={2} className="flex-shrink-0" />
              {branchLabel}
            </div>
          </Tooltip>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-[7px] h-[7px] rounded-full bg-[hsl(var(--git-added))] status-pulse flex-shrink-0" />
            <span className="text-[13px] font-medium text-foreground whitespace-nowrap">
              {activeTask.name}
            </span>
          </div>
          {activeTask.linkedItems && activeTask.linkedItems.length > 0 ? (
            <div className="flex items-center gap-1">
              {activeTask.linkedItems.map((item) => {
                const url = linkedItemUrl(item, activeProject?.gitRemote ?? null);
                const linkEl = url ? (
                  <a
                    key={`${item.provider}-${item.id}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                  >
                    #{item.id}
                  </a>
                ) : (
                  <span
                    key={`${item.provider}-${item.id}`}
                    className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
                  >
                    #{item.id}
                  </span>
                );
                return item.title ? (
                  <Tooltip key={`${item.provider}-${item.id}`} content={item.title}>
                    {linkEl}
                  </Tooltip>
                ) : (
                  linkEl
                );
              })}
            </div>
          ) : null}
          <div className="ml-auto flex items-center gap-1.5">
            {activeTask.useWorktree && (
              <Tooltip content="Worktree">
                <div className="flex items-center gap-1.5 text-foreground/60 min-w-0 flex-shrink max-w-[180px]">
                  <FolderGit2 size={11} strokeWidth={2} className="flex-shrink-0" />
                  <span className="text-[11px] font-mono truncate">
                    {activeTask.path.split('/').pop()}
                  </span>
                </div>
              </Tooltip>
            )}
            <Tooltip content={branchTooltip}>
              <div className="flex items-center gap-1.5 text-foreground/60 min-w-0 flex-shrink max-w-[180px]">
                <GitBranch size={11} strokeWidth={2} className="flex-shrink-0" />
                {branchLabel}
              </div>
            </Tooltip>
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
            {prInfo && (
              <Tooltip content={prInfo.title}>
                <a
                  href={prInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-[10px] font-medium hover:bg-green-500/20 transition-colors"
                >
                  <GitPullRequest size={10} strokeWidth={2} />
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
