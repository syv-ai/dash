import { useState, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import type { Task, ActivityInfo, ContextUsage } from '../../../shared/types';
import { TaskActions } from '../task/TaskActions';
import { TaskContextMenu } from '../task/TaskContextMenu';
import { TreeRow, type TreeRowContext } from '../ui/Tree';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { Tooltip } from '../ui/Tooltip';
import { MainRepoBadge } from '../ui/MainRepoBadge';
import { FavoriteStar } from '../ui/FavoriteStar';
import { PrBadge } from '../ui/PrBadge';
import { SetupStatus } from '../task/SetupStatus';
import type { DragHandlers } from '../../hooks/useDragReorder';
import { useRuntime } from '../../stores/runtimeStore';
import { useGit } from '../../stores/gitStore';
import { STATE_LABELS, failureReason, isAtRest } from './taskStates';
import { ContextLevel } from './ContextLevel';

interface TaskCardProps {
  task: Task;
  /** From `Tree`: the row's node, selection (the active task), tab stop. */
  ctx: TreeRowContext;
  /** The task's agent state (`agentState`), its dot. */
  state: AgentState;
  /** The second line (the Tasks view's project and why); none in Projects. */
  description?: ReactNode;
  /** The session's context, read as the percent at the row's end. */
  usage?: ContextUsage;
  /** Pixels per tree level (a project's tasks sit `TASK_INDENT_PX` in). */
  indentStep?: number;
  /** Drag to reorder (the Projects view). */
  drag?: { isDragging: boolean; handlers: DragHandlers };
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

/**
 * A task row, the same in the Tasks and Projects views: the state dot, the
 * name with its marks (a favourite's star, the main-checkout M: labels, not
 * controls, T22), the second line if any; at the end the status badges, the
 * actions on hover (sleep, "…"), then the context percent, always the last
 * column so it lines up down the list (T21). Dot and end centre on the row.
 * Right-click opens the task menu.
 */
export function TaskCard({
  task,
  ctx,
  state,
  description,
  usage,
  indentStep,
  drag,
  onSelect,
  onOpenIde,
  onClose,
  onSettings,
  onArchive,
  onDelete,
}: TaskCardProps) {
  // The "…" menu is open: keep the actions shown though the pointer has left.
  const [menuOpen, setMenuOpen] = useState(false);
  const activityInfo = useRuntime((s) => s.taskActivity[task.id]);
  const hasRemoteControl = useRuntime((s) => !!s.remoteControlStates[task.id]);
  const prs = useGit((s) => s.prByTask[task.id]);
  const allPrs = useGit((s) => s.branchPrsByTask[task.id]);

  const badges = (task.favorite || !task.useWorktree) && (
    <>
      {task.favorite && <FavoriteStar />}
      {/* Runs in the project's own checkout, not a worktree */}
      {!task.useWorktree && <MainRepoBadge task={task} />}
    </>
  );

  return (
    <TaskContextMenu
      taskId={task.id}
      onOpenIde={onOpenIde}
      onSleep={onClose}
      onSettings={onSettings}
      onArchive={onArchive}
      onDelete={onDelete}
    >
      <TreeRow
        ctx={ctx}
        indentStep={indentStep}
        draggable={!!drag}
        {...drag?.handlers}
        className="group/task"
        dragging={drag?.isDragging}
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
        badges={badges}
        description={description}
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
            {state !== 'asleep' && <ContextLevel usage={usage} />}
          </>
        }
      >
        {task.name}
      </TreeRow>
    </TaskContextMenu>
  );
}
