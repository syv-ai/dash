import { ChevronRight, GitGraph, Globe, MoreHorizontal, PanelLeft, PanelRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project, Task } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { useGit } from '../../stores/gitStore';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { formatBinding } from '../../keybindings';
import { IconButton } from '../ui/IconButton';
import { IdeIcon } from '../ui/IdeIcon';
import { PrBadge } from '../ui/PrBadge';
import { TokenBadge } from '../ui/TokenBadge';
import { TextLink } from '../ui/TextLink';
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
import { useFittedDensity } from '../ui/useFittedDensity';
import { cn } from '../../lib/cn';
import { LinkedItemLinks } from './LinkedItemLinks';
import { HEADER_LABELS, type HeaderLabel, fitTaskHeader, labelShows } from './headerFit';

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

/**
 * The task sheet's title row: the name, a chevron and the branch, and linked
 * issues on the left; the model, token badge and pull request, then open in IDE,
 * "…" (remote control, commit graph, the task's actions) and the
 * right-sidebar toggle on the right. The labels fit by measurement
 * (`headerFit`). Ahead/behind live in Files' sync row.
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
  const {
    rootRef,
    sizerRef,
    density: hidden,
    needs,
  } = useFittedDensity<number>(fitTaskHeader, 0, null);

  const branch = gitStatus?.branch || task.branch;
  const branchHref =
    branch && project.gitRemote && gitStatus?.hasUpstream
      ? branchUrl(project.gitRemote, branch)
      : null;
  // Each label once, rendered in the row and as its invisible measuring copy.
  const labels: Record<HeaderLabel, ReactNode> = {
    // The chevron rides with the branch, so it gives way with it.
    branch: branch && (
      <span className="inline-flex items-center gap-1.5">
        <ChevronRight size={12} strokeWidth={1.8} className="-ml-1 shrink-0 text-icon" />
        <Tooltip
          content={
            branchHref
              ? `${branch} · open the branch on the remote`
              : gitStatus?.hasUpstream === false
                ? `${branch} (no upstream)`
                : branch
          }
        >
          {/* Capped so a long branch doesn't crowd the row; the tooltip names it. */}
          {branchHref ? (
            <span className="max-w-64 truncate">
              <TextLink href={branchHref}>{branch}</TextLink>
            </span>
          ) : (
            <span className="max-w-64 truncate">{branch}</span>
          )}
        </Tooltip>
      </span>
    ),
    linked: task.linkedItems && task.linkedItems.length > 0 && (
      <LinkedItemLinks items={task.linkedItems} gitRemote={project.gitRemote ?? null} />
    ),
    model: modelName && (
      <Tooltip content="Model">
        <span className="whitespace-nowrap">{modelName}</span>
      </Tooltip>
    ),
    tokens: showTokens && (
      <TokenBadge
        totalTokens={task.totalTokens}
        totalCostUsd={task.totalCostUsd}
        size="sm"
        precise
      />
    ),
    pr: <PrBadge prs={prs} allPrs={allPrs} taskId={task.id} variant="button" />,
  };
  // A label that renders nothing (no tokens, no PR) measures 0
  // and takes no slot, so it leaves no stray gap. Unmeasured, all show.
  const label = (name: HeaderLabel) =>
    labelShows(name, hidden) &&
    needs[HEADER_LABELS.indexOf(name) + 1] !== 0 && (
      <div className="titlebar-no-drag flex shrink-0 items-center">{labels[name]}</div>
    );
  const nameClass = cn(
    'min-w-0 truncate text-base font-semibold text-ink',
    !sidebarCollapsed && 'pl-2',
  );

  return (
    <div className="titlebar-drag flex h-11 shrink-0 items-center gap-2.5 pl-3 pr-2">
      {sidebarCollapsed && (
        <div className="titlebar-no-drag -mr-1">
          <IconButton
            title="Show sidebar"
            shortcut={keybindings.toggleSidebar}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      )}
      {/* The name and the labels, fitted by measurement (`headerFit`): the
          name truncates down to NAME_MIN_PX, then the labels give way one at
          a time, the token count first, the pull request last. */}
      <div
        ref={rootRef}
        className="relative flex min-w-0 flex-1 items-center gap-2.5 text-sm text-ink-3"
      >
        <h1 className={nameClass}>{task.name}</h1>
        {label('branch')}
        {label('linked')}
        <div className="flex-1" />
        {label('model')}
        {label('tokens')}
        {label('pr')}
        <div
          ref={sizerRef}
          aria-hidden
          className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
        >
          <div className={cn(nameClass, 'w-max')}>{task.name}</div>
          {HEADER_LABELS.map((name) => (
            <div key={name} className="flex w-max">
              {labels[name]}
            </div>
          ))}
        </div>
      </div>

      <div className="titlebar-no-drag flex shrink-0 items-center gap-0.5">
        <IconButton title={openLabel} onClick={onOpenIde}>
          <IdeIcon ideId={ideId} />
        </IconButton>
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
            <DropdownMenuItem onSelect={onShowCommitGraph}>
              <GitGraph size={13} strokeWidth={1.8} />
              Commit graph
              {keybindings.commitGraph && (
                <DropdownMenuShortcut>
                  {formatBinding(keybindings.commitGraph)}
                </DropdownMenuShortcut>
              )}
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
          title={inspectorCollapsed ? 'Show task sidebar' : 'Hide task sidebar'}
          shortcut={keybindings.toggleInspector}
          onClick={onToggleInspector}
        >
          <PanelRight size={14} strokeWidth={1.8} />
        </IconButton>
      </div>
    </div>
  );
}
