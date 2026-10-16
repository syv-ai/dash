import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useDragReorder } from '../../hooks/useDragReorder';
import { IconButton } from '../ui/IconButton';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { Tooltip } from '../ui/Tooltip';
import { MainRepoBadge } from '../ui/MainRepoBadge';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import { SlidingPill, useSlidingPill } from './useSlidingPill';
import { groupByProject } from './rotationGroups';
import type { Project, Task, ContextUsage } from '../../../shared/types';

/* ── Rotation (Active Tasks) with a sliding selection pill ── */

type RotationRow = { task: Task; phase: 'entering' | 'present' | 'leaving' };
const ROTATION_EXIT_MS = 320;
const ROW_TRANSITION =
  'grid-template-rows 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)';

export function RotationSection({
  rotationTasks,
  activeTaskId,
  unseenTaskIds,
  projects,
  onSelectTask,
  onReorderRotation,
  onRemoveFromRotation,
  contextUsage = {},
}: {
  rotationTasks: Task[];
  activeTaskId: string | null;
  unseenTaskIds?: Set<string>;
  projects: Project[];
  onSelectTask: (projectId: string, taskId: string) => void;
  onReorderRotation?: (reordered: Task[]) => void;
  onRemoveFromRotation?: (taskId: string) => void;
  contextUsage?: Record<string, ContextUsage>;
}) {
  const taskActivity = useRuntime((s) => s.taskActivity);
  const showPercent = useSettings((s) => s.showContextUsageOnTaskCards);
  // Rows drag within their project's group; the reordered group is spliced
  // back into the full list at the positions its tasks held.
  const rotationOnReorder = useCallback(
    (gId: string | undefined, reordered: Task[]) => {
      const queue = [...reordered];
      onReorderRotation?.(rotationTasks.map((t) => (t.projectId === gId ? queue.shift()! : t)));
    },
    [onReorderRotation, rotationTasks],
  );
  const rotationGetItems = useCallback(
    (gId: string | undefined) => rotationTasks.filter((t) => t.projectId === gId),
    [rotationTasks],
  );
  const { draggingId: draggingRotId, getDragHandlers: getRotDragHandlers } = useDragReorder<Task>({
    onReorder: rotationOnReorder,
    getItems: rotationGetItems,
  });

  // Track displayed rows so removed items can animate out before unmounting.
  // Initial mount renders rows as 'present' (no entry animation), matching the
  // previous AnimatePresence `initial={false}` behavior.
  const [rows, setRows] = useState<RotationRow[]>(() =>
    rotationTasks.map((task) => ({ task, phase: 'present' as const })),
  );

  useEffect(() => {
    setRows((prev) => {
      const nextIds = new Set(rotationTasks.map((t) => t.id));
      const prevById = new Map(prev.map((r) => [r.task.id, r] as const));
      // Items still present, in incoming order. Revive any that were mid-exit.
      const next: RotationRow[] = rotationTasks.map((task) => {
        const existing = prevById.get(task.id);
        if (!existing) return { task, phase: 'entering' };
        return { task, phase: existing.phase === 'leaving' ? 'present' : existing.phase };
      });
      // Items no longer in the list stay mounted as 'leaving' to play exit anim.
      for (const r of prev) {
        if (!nextIds.has(r.task.id)) {
          next.push({ task: r.task, phase: 'leaving' });
        }
      }
      return next;
    });
  }, [rotationTasks]);

  // Flip 'entering' → 'present' on next frame so the transition fires.
  useEffect(() => {
    if (!rows.some((r) => r.phase === 'entering')) return;
    const id = requestAnimationFrame(() => {
      setRows((prev) =>
        prev.map((r) => (r.phase === 'entering' ? { ...r, phase: 'present' as const } : r)),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [rows]);

  // Drop 'leaving' rows once their collapse transition finishes.
  useEffect(() => {
    if (!rows.some((r) => r.phase === 'leaving')) return;
    const id = setTimeout(() => {
      setRows((prev) => prev.filter((r) => r.phase !== 'leaving'));
    }, ROTATION_EXIT_MS);
    return () => clearTimeout(id);
  }, [rows]);

  // The active row's pill fades out while its row animates out of the list.
  const activeLeaving = rows.some((r) => r.task.id === activeTaskId && r.phase === 'leaving');
  const { containerRef, setRow, pill } = useSlidingPill(activeTaskId, activeLeaving, rows);
  // Columns are reserved only when some row fills them, so an unused one
  // doesn't leave a gap down the whole list.
  const anyMainRepo = rows.some((r) => !r.task.useWorktree);
  const anyPercent =
    showPercent && rows.some((r) => (contextUsage[r.task.id]?.percentage ?? 0) > 0);
  const groups = groupByProject(rows, (r) => r.task, projects);

  return (
    <div className="px-2 pt-1.5 pb-1.5 mb-0.5">
      <Tooltip content="Cycle with Ctrl+Tab">
        <span className="block px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-fade-70 select-none">
          Active tasks
        </span>
      </Tooltip>
      <div ref={containerRef} className="relative isolate space-y-px">
        <SlidingPill pill={pill} />
        {groups.map((group, gi) => {
          const project = projects.find((p) => p.id === group.projectId);
          // The header stays while any of its rows is shown, and animates in
          // and out with the group's first and last rows.
          const headerShown = group.items.some((r) => r.phase === 'present');
          const groupTasks = rotationTasks.filter((t) => t.projectId === group.projectId);
          return (
            <div key={group.projectId} className="space-y-px">
              <div
                className="grid"
                style={{
                  gridTemplateRows: headerShown ? '1fr' : '0fr',
                  opacity: headerShown ? 1 : 0,
                  transition: ROW_TRANSITION,
                }}
              >
                <div className="overflow-hidden">
                  <span
                    className={`block truncate pl-3.5 pr-2 pb-0.5 text-[11px] text-muted-fade-60 select-none ${
                      gi === 0 ? '' : 'pt-2'
                    }`}
                  >
                    {project?.name ?? 'Unknown project'}
                  </span>
                </div>
              </div>
              {group.items.map(({ task, phase }) => {
                const collapsed = phase !== 'present';
                const activity = taskActivity[task.id]?.state;
                const isActiveTask = task.id === activeTaskId;
                const ctx = contextUsage[task.id];

                return (
                  <div
                    key={task.id}
                    // The pill tracks this wrapper, not the row inside it: the
                    // wrapper's height is what animates as a row enters or leaves.
                    ref={(el) => setRow(task.id, el)}
                    className="grid"
                    style={{
                      gridTemplateRows: collapsed ? '0fr' : '1fr',
                      opacity: collapsed ? 0 : 1,
                      transition: ROW_TRANSITION,
                    }}
                  >
                    <div className="overflow-hidden">
                      <div
                        draggable
                        {...getRotDragHandlers(task.id, groupTasks, task.projectId)}
                        className={`group/swap relative flex items-start gap-2 min-w-0 pl-3.5 pr-2 py-[6px] rounded-md text-[13px] cursor-pointer transition-[transform,color] duration-150 ${
                          isActiveTask
                            ? 'text-foreground font-medium scale-[1.035]'
                            : 'sidebar-row-hover text-muted-foreground hover:text-foreground'
                        } ${draggingRotId === task.id ? 'opacity-40' : ''}`}
                        onClick={() => onSelectTask(task.projectId, task.id)}
                      >
                        {/* Status indicator — nudged down to align with title baseline */}
                        {activity === 'error' ? (
                          <div className="status-dot-err w-[6px] h-[6px] rounded-full shrink-0 mt-[7px]" />
                        ) : activity === 'waiting' ? (
                          <div className="status-dot-wait w-[6px] h-[6px] rounded-full shrink-0 mt-[7px]" />
                        ) : activity === 'busy' ? (
                          <div className="w-[6px] h-[6px] rounded-full bg-amber-400 status-pulse shrink-0 mt-[7px]" />
                        ) : activity === 'idle' && unseenTaskIds?.has(task.id) ? (
                          <div className="status-dot-unseen w-[6px] h-[6px] rounded-full shrink-0 mt-[7px]" />
                        ) : activity === 'idle' ? (
                          <div className="status-dot-idle w-[6px] h-[6px] rounded-full shrink-0 mt-[7px]" />
                        ) : null}

                        <div className="flex flex-col flex-1 min-w-0 leading-tight">
                          {/* Title line — percentage and hover actions sit inline with
                        the title (matching the project-tree task rows). */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate flex-1 min-w-0">{task.name}</span>

                            {/* At rest: the "main" badge (runs in the project's own
                            checkout) and the context percentage, as columns — rows
                            without a badge hold an invisible one so they line up.
                            On hover the remove action slides in across them. */}
                            <HoverSwapSlot
                              rest={
                                <span className="flex items-center gap-1.5">
                                  {anyMainRepo && (
                                    <span className={`flex ${task.useWorktree ? 'invisible' : ''}`}>
                                      <MainRepoBadge branch={task.branch} />
                                    </span>
                                  )}
                                  {anyPercent && (
                                    <span
                                      className="w-6 text-right text-[11px] tabular-nums text-muted-foreground"
                                      title={
                                        ctx
                                          ? `Context: ${ctx.used.toLocaleString()} / ${ctx.total.toLocaleString()} tokens (${Math.round(ctx.percentage)}%)`
                                          : undefined
                                      }
                                    >
                                      {ctx && ctx.percentage > 0
                                        ? `${Math.round(ctx.percentage)}%`
                                        : ''}
                                    </span>
                                  )}
                                </span>
                              }
                              actions={
                                <IconButton
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveFromRotation?.(task.id);
                                  }}
                                  title="Remove from rotation"
                                  size="sm"
                                >
                                  <X size={12} strokeWidth={1.8} />
                                </IconButton>
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
