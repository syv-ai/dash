import type { ReactNode } from 'react';
import { Globe } from 'lucide-react';
import type { Task, ActivityInfo, ContextUsage } from '../../../shared/types';
import { SleepTaskButton } from '../task/TaskActions';
import { TaskContextMenu } from '../task/TaskContextMenu';
import { TreeRow, type TreeRowContext } from '../ui/Tree';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { Tooltip } from '../ui/Tooltip';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { MainRepoBadge } from '../ui/MainRepoBadge';
import { FavoriteStar } from '../ui/FavoriteStar';
import { PrBadge } from '../ui/PrBadge';
import type { DragHandlers } from '../../hooks/useDragReorder';
import { useRuntime } from '../../stores/runtimeStore';
import { useGit } from '../../stores/gitStore';
import { STATE_LABELS, failureReason, isAtRest } from './taskStates';
import { ContextLevel } from './ContextLevel';
import { cn } from '../../lib/cn';

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
  /** Set the percent column apart from the name and its marks (the Tasks
   *  view, whose rows lead with the name; T28). */
  spacedEnd?: boolean;
  /** Keep a two-digit percent's room on every row, sleeping ones too, so no
   *  name moves as a percent comes or changes (the Projects view). */
  reservePercent?: boolean;
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

/** A project's tasks sit 10px in: the dot just past the chevron's ink, the
 *  name under the project's name (T26). */
export const TASK_INDENT_PX = 10;

/**
 * A task row, the same in the Tasks and Projects views: the state dot, the
 * name with its marks (a favourite's star, the main-checkout M: labels, not
 * controls, T22), the second line if any; at the end the status badges, then
 * a live session's last column: the context percent at rest, the sleep
 * button in its place on hover or keyboard focus (T24). Dot and end centre
 * on the row. The task menu is right-click only (T23).
 */
export function TaskCard({
  task,
  ctx,
  state,
  description,
  usage,
  indentStep,
  drag,
  spacedEnd = false,
  reservePercent = false,
  onSelect,
  onOpenIde,
  onClose,
  onSettings,
  onArchive,
  onDelete,
}: TaskCardProps) {
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
        className="group/swap"
        dragging={drag?.isDragging}
        pressable
        dimmed={isAtRest(state)}
        strong={ctx.selected}
        onActivate={onSelect}
        leading={
          // A little more room than the row's gap between the orb and the
          // name and project (T28). On a one-line row the orb sits a pixel
          // low: it centres on the line box, which the 13px system font's
          // caps (and the M, the star, the percent) share, but a name reads
          // by its lowercase, whose x-height centres ~1px lower. A two-line
          // row's orb centres on both lines (T21) and stays put.
          <span className={cn('flex pr-1', !description && 'translate-y-px')}>
            {state === 'asleep' ? (
              <StatusDot state={state} />
            ) : (
              <Tooltip content={dotTooltip(state, activityInfo)}>
                <span className="flex">
                  <StatusDot state={state} label={STATE_LABELS[state]} />
                </span>
              </Tooltip>
            )}
          </span>
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
            {(prs || allPrs) && (
              <PrBadge prs={prs ?? []} allPrs={allPrs} variant="icon" taskId={task.id} />
            )}
            {/* One column at the row's end, while the session is live: the
                percent at rest, the sleep button in its place on hover or
                keyboard focus. It is as wide as the wider of the two, so the
                name keeps its width (T24) and a short percent leaves no slack
                before it (T26); right-aligned, the column lines up down the
                list. `reservePercent` keeps it on every row, at least a
                two-digit percent wide. */}
            {(state !== 'asleep' || reservePercent) && (
              <span className={cn('flex', spacedEnd && 'pl-2')}>
                <HoverSwapSlot
                  reserve
                  rest={<ContextLevel usage={usage} reserve={reservePercent} />}
                  actions={
                    <SleepTaskButton
                      activityState={activityInfo?.state}
                      onClose={onClose}
                      variant="ink"
                    />
                  }
                />
              </span>
            )}
          </>
        }
      >
        {task.name}
      </TreeRow>
    </TaskContextMenu>
  );
}
