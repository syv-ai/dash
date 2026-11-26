import { useState } from 'react';
import { Globe } from 'lucide-react';
import type { Task, ActivityInfo, PullRequestInfo } from '../../../shared/types';
import { TaskActions } from '../task/TaskActions';
import { TreeRow, type TreeRowContext } from '../ui/Tree';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { Tooltip } from '../ui/Tooltip';
import { MainRepoBadge } from '../ui/MainRepoBadge';
import { PrBadge } from '../ui/PrBadge';
import { SetupStatus } from '../task/SetupStatus';
import type { DragHandlers } from '../../hooks/useDragReorder';
import { STATE_LABELS, agentState, failureReason, isAtRest } from './taskStates';

interface TaskCardProps {
  task: Task;
  /** From `Tree`: the row's node, selection (the active task), tab stop. */
  ctx: TreeRowContext;
  activityInfo?: ActivityInfo;
  /** The PRs standing for the task's branch now, newest first. */
  prs?: PullRequestInfo[];
  /** Every PR from the branch, newest first (the badge's list). */
  allPrs?: PullRequestInfo[];
  isUnseen: boolean;
  hasRemoteControl: boolean;
  isDragging: boolean;
  dragHandlers: DragHandlers;
  onSelect: () => void;
  onOpenIde: () => void;
  onClose: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** What the state dot's tooltip says: the tool at work, the wait, the failure. */
function dotTooltip(state: AgentState, info: ActivityInfo | undefined): string {
  if (state === 'work') {
    if (info?.compacting) return 'Compacting context…';
    return info?.tool?.label ?? 'Claude is working';
  }
  if (state === 'needs') return info?.detail ? `Waiting: ${info.detail}` : 'Waiting for you';
  if (state === 'fail') return failureReason(info?.error);
  return STATE_LABELS[state];
}

/** A project's tasks sit 16px in, where its name starts past the chevron. */
export const TASK_INDENT_PX = 16;

/** A task row in the project tree: state dot, name, badges, and its actions on hover. */
export function TaskCard({
  task,
  ctx,
  activityInfo,
  prs,
  allPrs,
  isUnseen,
  hasRemoteControl,
  isDragging,
  dragHandlers,
  onSelect,
  onOpenIde,
  onClose,
  onSettings,
  onArchive,
  onDelete,
}: TaskCardProps) {
  // The "…" menu is open: keep the actions shown though the pointer has left.
  const [menuOpen, setMenuOpen] = useState(false);
  const state = agentState(activityInfo, isUnseen);

  return (
    <TreeRow
      ctx={ctx}
      indentStep={TASK_INDENT_PX}
      draggable
      {...dragHandlers}
      className="group/task"
      dragging={isDragging}
      dimmed={isAtRest(state)}
      strong={ctx.selected}
      onActivate={onSelect}
      leading={
        state === 'asleep' ? (
          <StatusDot state={state} />
        ) : (
          <Tooltip content={dotTooltip(state, activityInfo)}>
            <span className="flex">
              <StatusDot state={state} label={STATE_LABELS[state]} />
            </span>
          </Tooltip>
        )
      }
      trailing={
        <>
          {hasRemoteControl && (
            <Tooltip content="Remote control on">
              <span className="flex">
                <Globe size={12} strokeWidth={1.8} />
              </span>
            </Tooltip>
          )}
          {task.useWorktree && <SetupStatus worktreePath={task.path} variant="inline" />}
          {/* Runs in the project's own checkout, not a worktree */}
          {!task.useWorktree && <MainRepoBadge task={task} />}
          {(prs || allPrs) && (
            <PrBadge prs={prs ?? []} allPrs={allPrs} variant="icon" taskId={task.id} />
          )}
          <div className={menuOpen ? 'flex' : 'hidden group-hover/task:flex'}>
            <TaskActions
              taskId={task.id}
              activityState={activityInfo?.state}
              onOpenIde={onOpenIde}
              onClose={onClose}
              onSettings={onSettings}
              onArchive={onArchive}
              onDelete={onDelete}
              onMenuOpenChange={setMenuOpen}
            />
          </div>
        </>
      }
    >
      {task.name}
    </TreeRow>
  );
}
