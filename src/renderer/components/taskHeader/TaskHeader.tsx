import {
  ArrowDown,
  ArrowUp,
  FolderGit2,
  GitBranch,
  GitGraph,
  Globe,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
} from 'lucide-react';
import type { Project, Task } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { useGit } from '../../stores/gitStore';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { formatBinding, type KeyBinding } from '../../keybindings';
import { IconButton } from '../ui/IconButton';
import { IdeIcon } from '../ui/IdeIcon';
import { PrBadge } from '../ui/PrBadge';
import { TokenBadge } from '../ui/TokenBadge';
import { Tooltip } from '../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { TaskMenuItems, onTaskMenuCloseAutoFocus } from '../task/TaskMenuItems';
import { SetupStatus } from '../task/SetupStatus';
import { LinkedItemBadges } from './LinkedItemBadges';

interface TaskHeaderProps {
  task: Task;
  project: Project;
  /** The model the task's session runs (live, from its status line). */
  modelName: string | null;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onOpenIde: () => void;
  onShowCommitGraph: () => void;
  onEnableRemoteControl: () => void;
  onTaskSettings: () => void;
  onArchiveTask: () => void;
  onDeleteTask: () => void;
}

/** A tooltip label with its shortcut, e.g. "Commit graph  ⇧⌘G". */
function withShortcut(label: string, binding: KeyBinding | undefined): string {
  return binding ? `${label}  ${formatBinding(binding)}` : label;
}

/**
 * The task sheet's title row: name, branch, ahead/behind, setup status and
 * linked issues on the left; the model and token badge, then open in IDE,
 * commit graph, pull request, "…" and the right-sidebar toggle on the right.
 * The row drags the window; its controls don't.
 */
export function TaskHeader({
  task,
  project,
  modelName,
  sidebarCollapsed,
  inspectorCollapsed,
  onToggleSidebar,
  onToggleInspector,
  onOpenIde,
  onShowCommitGraph,
  onEnableRemoteControl,
  onTaskSettings,
  onArchiveTask,
  onDeleteTask,
}: TaskHeaderProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const prs = useGit((s) => s.prs);
  const allPrs = useGit((s) => s.branchPrsByTask[task.id]);
  const remoteControlOn = useRuntime((s) => !!s.remoteControlStates[task.id]);
  const keybindings = useSettings((s) => s.keybindings);
  const showTokens = useSettings((s) => s.showTaskTokens);
  const { ideId, openLabel } = usePreferredIde();

  const branch = gitStatus?.branch || task.branch;
  const branchHref =
    branch && project.gitRemote && gitStatus?.hasUpstream
      ? branchUrl(project.gitRemote, branch)
      : null;
  const BranchIcon = task.useWorktree ? FolderGit2 : GitBranch;
  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;

  const branchLabel = (
    <>
      <BranchIcon size={14} strokeWidth={1.8} className="shrink-0" />
      <span className="truncate font-mono">{branch}</span>
    </>
  );

  return (
    <div className="titlebar-drag flex h-11 shrink-0 items-center gap-2.5 pl-3 pr-2">
      {sidebarCollapsed && (
        <div className="titlebar-no-drag -mr-1">
          <IconButton
            title={withShortcut('Show sidebar', keybindings.toggleSidebar)}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      )}
      <h1
        className={`min-w-0 max-w-1/2 shrink truncate text-base font-semibold text-ink ${
          sidebarCollapsed ? '' : 'pl-2'
        }`}
      >
        {task.name}
      </h1>
      <div className="titlebar-no-drag flex min-w-0 shrink items-center gap-2.5 text-sm text-ink-3">
        {branch && (
          <Tooltip
            content={
              branchHref
                ? 'Open the branch on the remote'
                : gitStatus?.hasUpstream === false
                  ? 'Branch (no upstream)'
                  : 'Branch'
            }
          >
            {branchHref ? (
              <a
                href={branchHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-ink"
              >
                {branchLabel}
              </a>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5">{branchLabel}</span>
            )}
          </Tooltip>
        )}
        {ahead > 0 && (
          <Tooltip content={`${ahead} commit${ahead === 1 ? '' : 's'} ahead of the remote`}>
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
              <ArrowUp size={12} strokeWidth={1.8} />
              {ahead}
            </span>
          </Tooltip>
        )}
        {behind > 0 && (
          <Tooltip content={`${behind} commit${behind === 1 ? '' : 's'} behind the remote`}>
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
              <ArrowDown size={12} strokeWidth={1.8} />
              {behind}
            </span>
          </Tooltip>
        )}
        {task.useWorktree && <SetupStatus worktreePath={task.path} variant="pill" />}
        {task.linkedItems && task.linkedItems.length > 0 && (
          <LinkedItemBadges items={task.linkedItems} gitRemote={project.gitRemote ?? null} />
        )}
      </div>

      <div className="flex-1" />

      {(modelName || showTokens) && (
        <div className="titlebar-no-drag flex min-w-0 shrink items-center gap-2.5 text-sm text-ink-3">
          {modelName && (
            <Tooltip content="Model">
              <span className="truncate font-mono">{modelName}</span>
            </Tooltip>
          )}
          {showTokens && (
            <TokenBadge totalTokens={task.totalTokens} totalCostUsd={task.totalCostUsd} size="sm" />
          )}
        </div>
      )}

      <div className="titlebar-no-drag flex shrink-0 items-center gap-0.5">
        <IconButton title={openLabel} onClick={onOpenIde}>
          <IdeIcon ideId={ideId} />
        </IconButton>
        <IconButton
          title={withShortcut('Commit graph', keybindings.commitGraph)}
          onClick={onShowCommitGraph}
        >
          <GitGraph size={14} strokeWidth={1.8} />
        </IconButton>
        <PrBadge prs={prs} allPrs={allPrs} taskId={task.id} variant="button" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton title="More">
              <MoreHorizontal size={14} strokeWidth={1.8} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-52"
            onCloseAutoFocus={onTaskMenuCloseAutoFocus}
          >
            <DropdownMenuItem onSelect={onEnableRemoteControl}>
              <Globe size={13} strokeWidth={1.8} />
              Remote control
              {remoteControlOn && <DropdownMenuShortcut>On</DropdownMenuShortcut>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <TaskMenuItems
              taskId={task.id}
              onOpenIde={onOpenIde}
              onSettings={onTaskSettings}
              onArchive={onArchiveTask}
              onDelete={onDeleteTask}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          title={withShortcut(
            inspectorCollapsed ? 'Show task sidebar' : 'Hide task sidebar',
            keybindings.toggleInspector,
          )}
          onClick={onToggleInspector}
        >
          <PanelRight size={14} strokeWidth={1.8} />
        </IconButton>
      </div>
    </div>
  );
}
