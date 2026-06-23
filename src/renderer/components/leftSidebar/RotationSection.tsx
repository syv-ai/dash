import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useDragReorder } from '../../hooks/useDragReorder';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { useRuntime } from '../../stores/runtimeStore';
import type { Project, Task, ContextUsage } from '../../../shared/types';

/* ── Rotation (Active Tasks) with sliding highlight ──────── */

type RotationRow = { task: Task; phase: 'entering' | 'present' | 'leaving' };
const ROTATION_EXIT_MS = 320;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null);
  const hasAnimated = useRef(false);
  const rotationOnReorder = useCallback(
    (_gId: string | undefined, reordered: Task[]) => onReorderRotation?.(reordered),
    [onReorderRotation],
  );
  const rotationGetItems = useCallback(() => rotationTasks, [rotationTasks]);
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

  const setRowRef = useCallback((taskId: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(taskId, el);
    else rowRefs.current.delete(taskId);
  }, []);

  const measureHighlight = useCallback(() => {
    if (!activeTaskId || !containerRef.current) {
      setHighlight(null);
      return;
    }
    const row = rowRefs.current.get(activeTaskId);
    if (!row) {
      setHighlight(null);
      return;
    }
    // Use offsetTop/offsetHeight (transform-agnostic) instead of
    // getBoundingClientRect — rows have an entry/exit motion animation and
    // the bounding rect captures the in-flight transform, which would place
    // the pill below its resting position until a later re-render corrects it.
    setHighlight({
      top: row.offsetTop,
      height: row.offsetHeight,
    });
  }, [activeTaskId]);

  // While the rotation list is animating, we re-measure on every ResizeObserver
  // tick — and we don't want the pill's own transition to play catch-up against
  // those changes, since that would feel laggy. The pill snaps during the
  // animation and smoothly slides only for inter-row jumps (active task changes
  // between rows that are already at their resting size).
  const [isRotating, setIsRotating] = useState(false);
  useEffect(() => {
    measureHighlight();
    if (!hasAnimated.current) {
      requestAnimationFrame(() => {
        hasAnimated.current = true;
      });
    }
    setIsRotating(true);
    const t = setTimeout(() => setIsRotating(false), 700);
    return () => clearTimeout(t);
  }, [measureHighlight, rows]);

  // Keep the highlight glued to the active row while motion animates the
  // surrounding rows' heights — the container resizes as rows open/close,
  // so the pill needs to re-measure on every layout shift.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => measureHighlight());
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureHighlight]);

  return (
    <div className="px-2 pt-1.5 pb-1.5 mb-0.5">
      <Tooltip content="Cycle with Ctrl+Tab">
        <span className="block px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 select-none">
          Active tasks
        </span>
      </Tooltip>
      <div ref={containerRef} className="relative space-y-px">
        {/* Sliding highlight */}
        {highlight && (
          <div
            className="sidebar-pill-active absolute left-0 right-0 rounded-md pointer-events-none"
            style={{
              top: highlight.top,
              height: highlight.height,
              // Match the active row's scale pop (see the row's scale-[1.035])
              // so the highlight stays sized to the popped text.
              transform: 'scale(1.035)',
              transition:
                hasAnimated.current && !isRotating ? 'top 200ms ease, height 200ms ease' : 'none',
            }}
          />
        )}
        {rows.map(({ task, phase }) => {
          const collapsed = phase !== 'present';
          const activity = taskActivity[task.id]?.state;
          const isActiveTask = task.id === activeTaskId;
          const project = projects.find((p) => p.id === task.projectId);
          const ctx = contextUsage[task.id];

          return (
            <div
              key={task.id}
              ref={(el) => setRowRef(task.id, el)}
              className="grid"
              style={{
                gridTemplateRows: collapsed ? '0fr' : '1fr',
                opacity: collapsed ? 0 : 1,
                transition:
                  'grid-template-rows 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div className="overflow-hidden">
                <div
                  draggable
                  {...getRotDragHandlers(task.id, rotationTasks)}
                  className={`group/rot relative flex items-start gap-2 min-w-0 pl-3.5 pr-2 py-[6px] rounded-md text-[13px] cursor-pointer transition-[transform,color] duration-150 ${
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
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate flex-1 min-w-0">{task.name}</span>

                      {ctx && ctx.percentage > 0 && (
                        <span
                          className="text-[11px] tabular-nums shrink-0 group-hover/rot:hidden text-muted-foreground"
                          title={`Context: ${ctx.used.toLocaleString()} / ${ctx.total.toLocaleString()} tokens (${Math.round(ctx.percentage)}%)`}
                        >
                          {Math.round(ctx.percentage)}%
                        </span>
                      )}

                      <div className="hidden group-hover/rot:flex gap-0.5 shrink-0">
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
                      </div>
                    </div>
                    {project && (
                      <span className="truncate text-[10px] text-muted-foreground/50 font-normal mt-0.5">
                        {project.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
