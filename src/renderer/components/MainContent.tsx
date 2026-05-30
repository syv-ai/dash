import React from 'react';
import { TerminalPane } from './TerminalPane';
import { ProjectOverview } from './ProjectOverview';
import {
  FolderOpen,
  Code2,
  GitBranch,
  FolderGit2,
  GitPullRequest,
  GitMerge,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type {
  Project,
  Task,
  GitStatus,
  PullRequestInfo,
  RemoteControlState,
  ActivityInfo,
} from '../../shared/types';
import { branchUrl } from '../../shared/urls';
import { Tooltip } from './ui/Tooltip';

interface MainContentProps {
  activeTask: Task | null;
  activeProject: Project | null;
  tasks?: Task[];
  taskActivity?: Record<string, ActivityInfo>;
  gitStatus?: GitStatus | null;
  prInfo?: PullRequestInfo | null;
  remoteControlState?: RemoteControlState | null;
  isMac?: boolean;
  terminalBg?: string;
  sidebarCollapsed?: boolean;
  changesPanelCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onToggleChangesPanel?: () => void;
  onSelectTask?: (id: string) => void;
  onEnableRemoteControl?: () => void;
  onOpenIde?: () => void;
  onNewTask?: () => void;
  onProjectSettings?: () => void;
  onShowCommitGraph?: () => void;
  onDeleteProject?: () => void;
  archivedTasks?: Task[];
  onDeleteTask?: (id: string) => void;
  onArchiveTask?: (id: string) => void;
  onRestoreTask?: (id: string) => void;
}

export function MainContent({
  activeTask,
  activeProject,
  tasks = [],
  taskActivity = {},
  gitStatus = null,
  prInfo = null,
  remoteControlState = null,
  isMac = false,
  terminalBg,
  sidebarCollapsed = false,
  changesPanelCollapsed = false,
  onToggleSidebar,
  onToggleChangesPanel,
  onSelectTask,
  onEnableRemoteControl,
  onOpenIde,
  onNewTask,
  onProjectSettings,
  onShowCommitGraph,
  onDeleteProject,
  archivedTasks = [],
  onDeleteTask,
  onArchiveTask,
  onRestoreTask,
}: MainContentProps) {
  if (!activeProject) {
    return (
      <div className="h-full flex flex-col bg-background">
        {isMac && <div className="h-[28px] flex-shrink-0 titlebar-drag" />}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-accent/60 flex items-center justify-center mx-auto mb-4">
              <FolderOpen size={22} className="text-muted-foreground/40" strokeWidth={1.5} />
            </div>
            <h2 className="text-[15px] font-semibold text-foreground/80 mb-1.5">Dash</h2>
            <p className="text-[13px] text-muted-foreground/60">Open a folder to get started</p>
          </div>
        </div>
      </div>
    );
  }

  // Strip — always rendered when there's a project, holds left toggle + (optional crumb)
  // + (optional controls) + right toggle.

  const currentBranch = gitStatus?.branch || activeTask?.branch;
  const currentBranchUrl =
    currentBranch && activeProject?.gitRemote && gitStatus?.hasUpstream
      ? branchUrl(activeProject.gitRemote, currentBranch)
      : null;
  const branchTooltip = gitStatus?.hasUpstream
    ? activeTask?.useWorktree
      ? 'Worktree branch'
      : 'Branch'
    : 'Branch (no upstream)';
  const BranchIcon = activeTask?.useWorktree ? FolderGit2 : GitBranch;
  const LeftToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const RightToggleIcon = changesPanelCollapsed ? PanelRightOpen : PanelRightClose;
  const ghostBtn =
    'w-7 h-7 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors';

  const strip = (
    <div
      className={`flex-shrink-0 flex items-center justify-between gap-3 px-4 titlebar-drag ${
        isMac ? 'h-[56px]' : 'h-[52px]'
      }`}
      style={terminalBg ? { background: terminalBg } : undefined}
    >
      {/* Left cluster: left-sidebar toggle + crumb */}
      <div className="inline-flex items-center gap-3 min-w-0 titlebar-no-drag">
        <Tooltip content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <button onClick={onToggleSidebar} className={ghostBtn}>
            <LeftToggleIcon size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
        {activeTask && (
          <div className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground min-w-0">
            <span className="truncate max-w-[200px]">{activeProject.name}</span>
            <span className="text-foreground/30">›</span>
            <span className="text-foreground font-medium truncate max-w-[260px]">
              {activeTask.name}
            </span>
          </div>
        )}
      </div>

      {/* Right cluster: controls + right-inspector toggle */}
      <div className="inline-flex items-center gap-1.5 flex-shrink-0 titlebar-no-drag">
        {activeTask && currentBranch && (
          <Tooltip content={branchTooltip}>
            {currentBranchUrl ? (
              <a
                href={currentBranchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors font-mono text-[11px]"
              >
                <BranchIcon size={11} strokeWidth={2} />
                <span className="truncate max-w-[160px]">{currentBranch}</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded bg-foreground/5 text-muted-foreground font-mono text-[11px]">
                <BranchIcon size={11} strokeWidth={2} />
                <span className="truncate max-w-[160px]">{currentBranch}</span>
              </span>
            )}
          </Tooltip>
        )}

        {activeTask && prInfo && prInfo.state !== 'closed' && (
          <Tooltip content={`${prInfo.title} (${prInfo.state})`}>
            <a
              href={prInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 px-2 py-[3px] rounded font-mono text-[11px] transition-colors ${
                prInfo.state === 'merged'
                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                  : 'bg-[hsl(var(--git-added))]/10 text-[hsl(var(--git-added))] hover:bg-[hsl(var(--git-added))]/20'
              }`}
            >
              {prInfo.state === 'merged' ? (
                <GitMerge size={11} strokeWidth={2} />
              ) : (
                <GitPullRequest size={11} strokeWidth={2} />
              )}
              PR #{prInfo.number}
            </a>
          </Tooltip>
        )}

        {activeTask && (
          <Tooltip content="Remote control">
            <button
              onClick={onEnableRemoteControl}
              className={`w-6 h-6 rounded inline-flex items-center justify-center transition-colors ${
                remoteControlState
                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
              }`}
            >
              <Globe size={13} strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}

        {activeTask && (
          <Tooltip content="Open in IDE">
            <button
              onClick={onOpenIde}
              className="w-6 h-6 rounded inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <Code2 size={13} strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}

        <Tooltip content={changesPanelCollapsed ? 'Show inspector' : 'Hide inspector'}>
          <button onClick={onToggleChangesPanel} className={ghostBtn}>
            <RightToggleIcon size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {strip}
      <div className="flex-1 min-h-0 relative">
        {activeTask ? (
          <TerminalPane
            key={activeTask.id}
            id={activeTask.id}
            cwd={activeTask.path}
            autoApprove={activeTask.autoApprove}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}
