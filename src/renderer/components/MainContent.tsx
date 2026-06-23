import React from 'react';
import { TerminalPane } from './terminal/TerminalPane';
import { ProjectOverview } from './project/ProjectOverview';
import { useSettings } from '../stores/settingsStore';
import { useGit } from '../stores/gitStore';
import { useRuntime } from '../stores/runtimeStore';
import {
  FolderOpen,
  Code2,
  Blocks,
  GitBranch,
  FolderGit2,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type { Project, Task, LinkedItem } from '../../shared/types';
import { branchUrl, linkedItemUrl } from '../../shared/urls';
import { Tooltip } from './ui/Tooltip';
import { TokenBadge } from './ui/TokenBadge';
import { PrBadge } from './ui/PrBadge';

/**
 * Colored, linkable badges for the GitHub issues / ADO work items attached to a
 * task at creation. Rendered in the main-pane header next to the breadcrumb so
 * the attached issues are one click from the task. GitHub and ADO get distinct
 * hues; each badge deep-links to the issue and shows its title on hover.
 */
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
    <div className="inline-flex items-center gap-1 min-w-0">
      {visible.map((item) => {
        const url = linkedItemUrl(item, gitRemote);
        const key = `${item.provider}-${item.id}`;
        const tone =
          item.provider === 'ado'
            ? 'bg-primary/10 text-primary hover:bg-primary/20'
            : 'bg-[hsl(var(--git-added))]/10 text-[hsl(var(--git-added))] hover:bg-[hsl(var(--git-added))]/20';
        const badge = url ? (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`px-1.5 py-[2px] rounded-full text-[10px] font-medium transition-colors ${tone}`}
          >
            #{item.id}
          </a>
        ) : (
          <span
            key={key}
            className={`px-1.5 py-[2px] rounded-full text-[10px] font-medium ${tone}`}
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
      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

interface MainContentProps {
  activeTask: Task | null;
  activeProject: Project | null;
  tasks?: Task[];
  isMac?: boolean;
  terminalBg?: string;
  sidebarCollapsed?: boolean;
  changesPanelCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onToggleChangesPanel?: () => void;
  onSelectTask?: (id: string) => void;
  onEnableRemoteControl?: () => void;
  onOpenIde?: () => void;
  // Open the Extensions browser filtered to the given scope (taskId or projectId).
  onOpenExtensions?: (scopeId: string) => void;
  onNewTask?: () => void;
  onProjectSettings?: () => void;
  onShowCommitGraph?: () => void;
  onDeleteProject?: () => void;
  archivedTasks?: Task[];
  onCloseTask?: (id: string) => void;
  onTaskSettings?: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onArchiveTask?: (id: string) => void;
  onRestoreTask?: (id: string) => void;
}

export function MainContent({
  activeTask,
  activeProject,
  tasks = [],
  isMac = false,
  terminalBg,
  sidebarCollapsed = false,
  changesPanelCollapsed = false,
  onToggleSidebar,
  onToggleChangesPanel,
  onSelectTask,
  onEnableRemoteControl,
  onOpenIde,
  onOpenExtensions,
  onNewTask,
  onProjectSettings,
  onShowCommitGraph,
  onDeleteProject,
  archivedTasks = [],
  onCloseTask,
  onTaskSettings,
  onDeleteTask,
  onArchiveTask,
  onRestoreTask,
}: MainContentProps) {
  const showTaskTokens = useSettings((s) => s.showTaskTokens);
  const gitStatus = useGit((s) => s.gitStatus);
  const prInfo = useGit((s) => s.prInfo);
  const remoteControlStates = useRuntime((s) => s.remoteControlStates);
  const remoteControlState = activeTask ? (remoteControlStates[activeTask.id] ?? null) : null;
  if (!activeProject) {
    return (
      <div className="h-full flex flex-col bg-background">
        {isMac && <div className="h-[28px] shrink-0 titlebar-drag" />}
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
      className={`shrink-0 flex items-center justify-between gap-3 px-4 titlebar-drag ${
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
        {activeTask?.linkedItems && activeTask.linkedItems.length > 0 && (
          <LinkedItemBadges
            items={activeTask.linkedItems}
            gitRemote={activeProject.gitRemote ?? null}
          />
        )}
      </div>

      {/* Right cluster: controls + right-inspector toggle */}
      <div className="inline-flex items-center gap-1.5 shrink-0 titlebar-no-drag">
        {activeTask && showTaskTokens && (
          <TokenBadge totalTokens={activeTask.totalTokens} totalCostUsd={activeTask.totalCostUsd} />
        )}
        {activeTask && currentBranch && (
          <Tooltip content={branchTooltip}>
            {currentBranchUrl ? (
              <a
                href={currentBranchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors font-mono text-[11px]"
              >
                <BranchIcon size={11} strokeWidth={2} />
                <span className="truncate max-w-[160px]">{currentBranch}</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-foreground/5 text-muted-foreground font-mono text-[11px]">
                <BranchIcon size={11} strokeWidth={2} />
                <span className="truncate max-w-[160px]">{currentBranch}</span>
              </span>
            )}
          </Tooltip>
        )}

        {activeTask && prInfo && <PrBadge prInfo={prInfo} />}

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
          <Tooltip content="Extensions">
            <button
              onClick={() =>
                onOpenExtensions?.(
                  activeTask.useWorktree ? `task:${activeTask.id}` : `project:${activeProject.id}`,
                )
              }
              className="w-6 h-6 rounded inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <Blocks size={13} strokeWidth={1.8} />
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

        {/* The inspector toggles the per-task changes panel, which only exists
            in the task view — not on the project overview. */}
        {activeTask && (
          <Tooltip content={changesPanelCollapsed ? 'Show inspector' : 'Hide inspector'}>
            <button onClick={onToggleChangesPanel} className={ghostBtn}>
              <RightToggleIcon size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <div
        className="h-[16px] shrink-0 titlebar-drag"
        style={terminalBg ? { background: terminalBg } : undefined}
      />
      {strip}
      <div className="flex-1 min-h-0 relative">
        {activeTask ? (
          <TerminalPane
            key={activeTask.id}
            id={activeTask.id}
            cwd={activeTask.path}
            permissionMode={activeTask.permissionMode}
            terminalBg={terminalBg}
          />
        ) : (
          <ProjectOverview
            project={activeProject}
            tasks={tasks}
            archivedTasks={archivedTasks}
            onSelectTask={(id) => onSelectTask?.(id)}
            onNewTask={() => onNewTask?.()}
            onProjectSettings={() => onProjectSettings?.()}
            onOpenExtensions={() => onOpenExtensions?.(`project:${activeProject.id}`)}
            onShowCommitGraph={() => onShowCommitGraph?.()}
            onDeleteProject={() => onDeleteProject?.()}
            onCloseTask={(id) => onCloseTask?.(id)}
            onTaskSettings={(id) => onTaskSettings?.(id)}
            onDeleteTask={(id) => onDeleteTask?.(id)}
            onArchiveTask={(id) => onArchiveTask?.(id)}
            onRestoreTask={(id) => onRestoreTask?.(id)}
          />
        )}
      </div>
    </div>
  );
}
