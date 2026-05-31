import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDragReorder } from '../hooks/useDragReorder';
import { UsageBarInline, usageTextColor } from './ui/UsageBar';
import {
  Plus,
  Trash2,
  Archive,
  ArchiveRestore,
  Settings,
  GitBranch,
  GitGraph,
  Globe,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Blocks,
  X,
} from 'lucide-react';
import type {
  Project,
  Task,
  RemoteControlState,
  ContextUsage,
  ActivityInfo,
} from '../../shared/types';
import { IconButton } from './ui/IconButton';
import { Tooltip } from './ui/Tooltip';

/* ── Rotation (Active Tasks) with sliding highlight ──────── */

function RotationSection({
  rotationTasks,
  activeTaskId,
  taskActivity,
  unseenTaskIds,
  projects,
  onSelectTask,
  onReorderRotation,
  onRemoveFromRotation,
  contextUsage = {},
}: {
  rotationTasks: Task[];
  activeTaskId: string | null;
  taskActivity: Record<string, ActivityInfo>;
  unseenTaskIds?: Set<string>;
  projects: Project[];
  onSelectTask: (projectId: string, taskId: string) => void;
  onReorderRotation?: (reordered: Task[]) => void;
  onRemoveFromRotation?: (taskId: string) => void;
  contextUsage?: Record<string, ContextUsage>;
}) {
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

  const setRowRef = useCallback((taskId: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(taskId, el);
    else rowRefs.current.delete(taskId);
  }, []);

  useEffect(() => {
    if (!activeTaskId || !containerRef.current) {
      setHighlight(null);
      return;
    }
    const row = rowRefs.current.get(activeTaskId);
    if (!row) {
      setHighlight(null);
      return;
    }
    const containerRect = containerRef.current.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setHighlight({
      top: rowRect.top - containerRect.top,
      height: rowRect.height,
    });
    // Enable transitions after first measurement
    if (!hasAnimated.current) {
      requestAnimationFrame(() => {
        hasAnimated.current = true;
      });
    }
  }, [activeTaskId, rotationTasks]);

  return (
    <div className="px-2 pt-3 pb-1.5 mb-0.5 border-b border-border">
      <Tooltip content="Cycle with Ctrl+Tab">
        <span className="block px-2 pb-1 text-[11px] font-medium text-muted-foreground/50 select-none tracking-wide uppercase">
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
              transition: hasAnimated.current ? 'top 200ms ease, height 200ms ease' : 'none',
            }}
          />
        )}
        {rotationTasks.map((task) => {
          const activity = taskActivity[task.id]?.state;
          const isActiveTask = task.id === activeTaskId;
          const project = projects.find((p) => p.id === task.projectId);
          const ctx = contextUsage[task.id];

          return (
            <div
              key={task.id}
              ref={(el) => setRowRef(task.id, el)}
              draggable
              {...getRotDragHandlers(task.id, rotationTasks)}
              className={`group/rot relative flex items-center gap-2 pl-3.5 pr-2 py-[5px] rounded-md text-[13px] cursor-pointer transition-colors duration-150 ${
                isActiveTask
                  ? 'text-foreground font-medium'
                  : 'sidebar-row-hover text-muted-foreground hover:text-foreground'
              } ${draggingRotId === task.id ? 'opacity-40' : ''}`}
              onClick={() => onSelectTask(task.projectId, task.id)}
            >
              {/* Status indicator */}
              {activity === 'error' ? (
                <div className="status-dot-err w-[6px] h-[6px] rounded-full flex-shrink-0" />
              ) : activity === 'waiting' ? (
                <div className="status-dot-wait w-[6px] h-[6px] rounded-full flex-shrink-0" />
              ) : activity === 'busy' ? (
                <div className="w-[6px] h-[6px] rounded-full bg-amber-400 status-pulse flex-shrink-0" />
              ) : activity === 'idle' && unseenTaskIds?.has(task.id) ? (
                <div className="status-dot-unseen w-[6px] h-[6px] rounded-full flex-shrink-0" />
              ) : activity === 'idle' ? (
                <div className="status-dot-idle w-[6px] h-[6px] rounded-full flex-shrink-0" />
              ) : null}

              <span className="truncate flex-1">{task.name}</span>
              {ctx && ctx.percentage > 0 && (
                <span
                  className={`text-[9px] tabular-nums flex-shrink-0 ${
                    ctx.percentage >= 80
                      ? 'text-red-400 font-medium'
                      : usageTextColor(ctx.percentage)
                  }`}
                  title={`Context: ${ctx.used.toLocaleString()} / ${ctx.total.toLocaleString()} tokens (${Math.round(ctx.percentage)}%)`}
                >
                  {Math.round(ctx.percentage)}%
                </span>
              )}
              {project && (
                <span className="text-muted-foreground/40 text-[11px] whitespace-nowrap overflow-hidden flex-shrink min-w-0 group-hover/rot:invisible">
                  {project.name}
                </span>
              )}

              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFromRotation?.(task.id);
                }}
                title="Remove from rotation"
                size="sm"
                className="hidden group-hover/rot:flex absolute right-2 top-1/2 -translate-y-1/2 flex-shrink-0"
              >
                <X size={12} strokeWidth={1.8} />
              </IconButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LeftSidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onOpenFolder: () => void;
  onDeleteProject: (id: string) => void;
  onProjectSettings: (id: string) => void;
  tasksByProject: Record<string, Task[]>;
  activeTaskId: string | null;
  onSelectTask: (projectId: string, taskId: string) => void;
  onNewTask: (projectId: string) => void;
  onDeleteTask: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onRestoreTask: (id: string) => void;
  onOpenSettings: () => void;
  onOpenPixelAgents?: () => void;
  onShowCommitGraph: (projectId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  taskActivity: Record<string, ActivityInfo>;
  unseenTaskIds?: Set<string>;
  remoteControlStates?: Record<string, RemoteControlState>;
  contextUsage?: Record<string, ContextUsage>;
  onReorderProjects?: (reordered: Project[]) => void;
  onReorderTasks?: (projectId: string, reordered: Task[]) => void;
  onReorderTasksCommit?: (projectId: string, reordered: Task[]) => void;
  pixelAgentsConnectedCount?: number;
  rotationTasks?: Task[];
  onReorderRotation?: (reordered: Task[]) => void;
  onRemoveFromRotation?: (taskId: string) => void;
  showActiveTasksSection?: boolean;
  onToggleActiveTasksSection?: () => void;
  onOpenSkillsBrowser?: () => void;
}

export function LeftSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenFolder,
  onDeleteProject,
  onProjectSettings,
  tasksByProject,
  activeTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
  onArchiveTask,
  onRestoreTask,
  onOpenSettings,
  onOpenPixelAgents,
  onShowCommitGraph,
  collapsed,
  onToggleCollapse,
  taskActivity,
  unseenTaskIds,
  remoteControlStates = {},
  contextUsage = {},
  onReorderProjects,
  onReorderTasks,
  onReorderTasksCommit,
  pixelAgentsConnectedCount = 0,
  rotationTasks = [],
  onReorderRotation,
  onRemoveFromRotation,
  showActiveTasksSection = true,
  onToggleActiveTasksSection,
  onOpenSkillsBrowser,
}: LeftSidebarProps) {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [collapsedArchived, setCollapsedArchived] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const taskOnReorder = useCallback(
    (groupId: string | undefined, reordered: Task[]) => {
      if (groupId) onReorderTasks?.(groupId, reordered);
    },
    [onReorderTasks],
  );
  const taskOnCommit = useCallback(
    (groupId: string | undefined, reordered: Task[]) => {
      if (groupId) onReorderTasksCommit?.(groupId, reordered);
    },
    [onReorderTasksCommit],
  );
  const taskGetItems = useCallback(
    (groupId: string | undefined) =>
      (tasksByProject[groupId ?? ''] || []).filter((t) => !t.archivedAt),
    [tasksByProject],
  );
  const { draggingId: draggingTaskId, getDragHandlers: getTaskDragHandlers } = useDragReorder<Task>(
    {
      onReorder: taskOnReorder,
      onCommit: taskOnCommit,
      getItems: taskGetItems,
    },
  );

  function toggleCollapse(projectId: string) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function toggleArchivedCollapse(projectId: string) {
    setCollapsedArchived((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function projectActivity(projectId: string): 'busy' | 'idle' | 'waiting' | 'error' | null {
    const tasks = (tasksByProject[projectId] || []).filter((t) => !t.archivedAt);
    if (tasks.some((t) => taskActivity[t.id]?.state === 'error')) return 'error';
    if (tasks.some((t) => taskActivity[t.id]?.state === 'waiting')) return 'waiting';
    if (tasks.some((t) => taskActivity[t.id]?.state === 'busy')) return 'busy';
    if (tasks.some((t) => taskActivity[t.id]?.state === 'idle')) return 'idle';
    return null;
  }

  /* ── Collapsed ──────────────────────────────────────────── */

  const isMac = window.electronAPI.getPlatform() === 'darwin';

  if (collapsed) {
    const showRotation = showActiveTasksSection && rotationTasks.length > 0;

    return (
      <div className="sidebar-shell h-full flex flex-col items-center gap-1">
        {isMac && <div className="h-[28px] w-full flex-shrink-0 titlebar-drag" />}
        <div className="h-2" />

        {showRotation && (
          <>
            <div className="flex flex-col items-center gap-1 w-full">
              {rotationTasks.map((task) => {
                const activity = taskActivity[task.id]?.state;
                const isActiveTask = task.id === activeTaskId;
                return (
                  <div key={task.id} className="relative flex items-center justify-center w-full">
                    <Tooltip content={task.name}>
                      <button
                        onClick={() => onSelectTask(task.projectId, task.id)}
                        className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 text-[11px] font-medium transition-colors titlebar-no-drag ${
                          isActiveTask
                            ? 'sidebar-pill-active text-primary'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                        }`}
                      >
                        {task.name.charAt(0).toUpperCase()}
                      </button>
                    </Tooltip>
                    {activity === 'error' ? (
                      <div className="status-dot-err absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" />
                    ) : activity === 'waiting' ? (
                      <div className="status-dot-wait absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" />
                    ) : activity === 'busy' ? (
                      <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 status-pulse" />
                    ) : activity === 'idle' && unseenTaskIds?.has(task.id) ? (
                      <div className="status-dot-unseen absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" />
                    ) : activity === 'idle' ? (
                      <div className="status-dot-idle absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="w-6 border-t border-border/30 my-1" />
          </>
        )}

        <Tooltip content="Create project">
          <button
            onClick={onOpenFolder}
            className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          >
            <Plus size={18} strokeWidth={1.8} />
          </button>
        </Tooltip>

        <div className="w-6 border-t border-border/30 my-1" />

        <div
          className="flex-1 min-h-0 flex flex-col items-center gap-1 w-full"
          style={{
            overflow: 'clip',
            overflowClipMargin: '8px',
          }}
        >
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const activity = projectActivity(project.id);
            const activityLabel =
              activity === 'error'
                ? 'Error'
                : activity === 'waiting'
                  ? 'Waiting for user'
                  : activity === 'busy'
                    ? 'Claude is working'
                    : 'Idle';

            return (
              <div
                key={project.id}
                className={`relative flex items-center justify-center w-full ${draggingId === project.id ? 'opacity-40' : ''}`}
              >
                <Tooltip content={project.name}>
                  <button
                    draggable
                    onDragStart={(e) => {
                      dragIdRef.current = project.id;
                      setDraggingId(project.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const fromId = dragIdRef.current;
                      if (!fromId || fromId === project.id) return;
                      const fromIdx = projects.findIndex((p) => p.id === fromId);
                      const toIdx = projects.findIndex((p) => p.id === project.id);
                      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
                      const reordered = [...projects];
                      const [moved] = reordered.splice(fromIdx, 1);
                      reordered.splice(toIdx, 0, moved);
                      onReorderProjects?.(reordered);
                    }}
                    onDrop={(e) => e.preventDefault()}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                      setDraggingId(null);
                    }}
                    onClick={() => onSelectProject(project.id)}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-medium transition-transform duration-200 ease-in-out titlebar-no-drag ${
                      isActive
                        ? 'sidebar-pill-active text-primary'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    }`}
                  >
                    {project.name.charAt(0).toUpperCase() + project.name.charAt(1).toLowerCase()}
                  </button>
                </Tooltip>
                {activity && (
                  <Tooltip content={activityLabel}>
                    <div
                      className={`absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${
                        activity === 'error'
                          ? 'status-dot-err'
                          : activity === 'waiting'
                            ? 'status-dot-wait'
                            : activity === 'busy'
                              ? 'bg-amber-400 status-pulse'
                              : 'status-dot-idle'
                      }`}
                    />
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        <div className="w-6 border-t border-border/30 my-1" />

        <Tooltip content="Skills">
          <button
            onClick={onOpenSkillsBrowser}
            className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          >
            <Blocks size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>

        <Tooltip
          content={
            pixelAgentsConnectedCount > 0
              ? `Settings · ${pixelAgentsConnectedCount} ${pixelAgentsConnectedCount === 1 ? 'office' : 'offices'}`
              : 'Settings'
          }
        >
          <button
            onClick={onOpenSettings}
            className="relative w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          >
            <Settings size={18} strokeWidth={1.5} />
            {pixelAgentsConnectedCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-semibold leading-none tabular-nums flex items-center justify-center text-[hsl(var(--git-added))] bg-[hsl(var(--surface-2))] border-2 border-[hsl(var(--surface-1))]"
                style={{ boxShadow: '0 0 8px hsl(var(--git-added) / 0.4)' }}
              >
                {pixelAgentsConnectedCount}
              </span>
            )}
          </button>
        </Tooltip>
      </div>
    );
  }

  /* ── Expanded ───────────────────────────────────────────── */

  return (
    <div className="sidebar-shell h-full flex flex-col">
      {isMac && <div className="h-[28px] flex-shrink-0 titlebar-drag" />}

      {/* Rotation section */}
      {showActiveTasksSection && rotationTasks.length > 0 && (
        <RotationSection
          rotationTasks={rotationTasks}
          activeTaskId={activeTaskId}
          taskActivity={taskActivity}
          unseenTaskIds={unseenTaskIds}
          projects={projects}
          onSelectTask={onSelectTask}
          onReorderRotation={onReorderRotation}
          onRemoveFromRotation={onRemoveFromRotation}
          contextUsage={contextUsage}
        />
      )}

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-1">
        <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
          <span className="text-[11px] font-medium text-muted-foreground/50 select-none tracking-wide uppercase">
            Projects
          </span>
          <Tooltip content="Create project">
            <button
              onClick={onOpenFolder}
              className="p-[3px] rounded text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors titlebar-no-drag"
            >
              <Plus size={13} strokeWidth={2} />
            </button>
          </Tooltip>
        </div>
        {projects.length === 0 && (
          <div className="px-2 py-10 text-center">
            <p className="text-[13px] text-muted-foreground/40 leading-relaxed">
              Open a folder to get started
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isProjectCollapsed = collapsedProjects.has(project.id);
            const allTasks = tasksByProject[project.id] || [];
            const projectTasks = allTasks.filter((t) => !t.archivedAt);
            const archivedTasks = allTasks.filter((t) => t.archivedAt);
            const isArchivedCollapsed = !collapsedArchived.has(project.id);

            return (
              <div key={project.id}>
                {/* Project row */}
                <div
                  draggable
                  onDragStart={(e) => {
                    dragIdRef.current = project.id;
                    setDraggingId(project.id);
                    e.dataTransfer.effectAllowed = 'move';
                    const el = e.currentTarget;
                    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const fromId = dragIdRef.current;
                    if (!fromId || fromId === project.id) return;
                    const fromIdx = projects.findIndex((p) => p.id === fromId);
                    const toIdx = projects.findIndex((p) => p.id === project.id);
                    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
                    const reordered = [...projects];
                    const [moved] = reordered.splice(fromIdx, 1);
                    reordered.splice(toIdx, 0, moved);
                    onReorderProjects?.(reordered);
                  }}
                  onDrop={(e) => e.preventDefault()}
                  onDragEnd={() => {
                    dragIdRef.current = null;
                    setDraggingId(null);
                  }}
                  className={`group relative flex items-center gap-1.5 px-2 h-8 rounded-md text-sm cursor-pointer transition-transform duration-200 ease-in-out ${
                    isActive
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  } ${draggingId === project.id ? 'opacity-40' : ''}`}
                  onClick={() => {
                    onSelectProject(project.id);
                    if (collapsedProjects.has(project.id)) {
                      toggleCollapse(project.id);
                    }
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(project.id);
                    }}
                    className="p-0.5 rounded flex-shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    {isProjectCollapsed ? (
                      <ChevronRight size={14} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={14} strokeWidth={2} />
                    )}
                  </button>

                  <span className="truncate flex-1">{project.name}</span>

                  {projectTasks.length > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0 mr-0.5 leading-none group-hover:invisible">
                      {projectTasks.length}
                    </span>
                  )}

                  {/* Action buttons — overlay from right on hover */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-[hsl(var(--surface-1))] rounded-md pl-1">
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewTask(project.id);
                      }}
                      title="New task"
                      size="sm"
                    >
                      <Plus size={13} strokeWidth={2} />
                    </IconButton>
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowCommitGraph(project.id);
                      }}
                      title="Commit graph"
                      size="sm"
                    >
                      <GitGraph size={13} strokeWidth={2} />
                    </IconButton>
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onProjectSettings(project.id);
                      }}
                      title="Project settings"
                      size="sm"
                    >
                      <Settings size={14} strokeWidth={1.8} />
                    </IconButton>
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(project.id);
                      }}
                      title="Delete project"
                      variant="destructive"
                      size="sm"
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </IconButton>
                  </div>
                </div>

                {/* Tasks nested under project */}
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-in-out"
                  style={{ gridTemplateRows: isProjectCollapsed ? '0fr' : '1fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="ml-6 mr-1 mt-0.5 space-y-px">
                      {projectTasks.map((task) => {
                        const activityInfo = taskActivity[task.id];
                        const activityState = activityInfo?.state;
                        const isActiveTask = task.id === activeTaskId;
                        const ctx = contextUsage[task.id];

                        // Build tooltip text with tool details when available
                        const busyTooltip = activityInfo?.compacting
                          ? 'Compacting context...'
                          : activityInfo?.tool?.label
                            ? activityInfo.tool.label
                            : 'Claude is working';
                        const errorTooltip = activityInfo?.error
                          ? activityInfo.error.type === 'rate_limit'
                            ? 'Rate limited'
                            : activityInfo.error.type === 'auth_error'
                              ? 'Authentication error'
                              : activityInfo.error.type === 'billing_error'
                                ? 'Billing error'
                                : 'Error'
                          : 'Error';

                        return (
                          <div
                            key={task.id}
                            draggable
                            {...getTaskDragHandlers(task.id, projectTasks, project.id)}
                            className={`group/task relative flex flex-col pl-3.5 pr-2 py-[6px] rounded-md text-[13px] cursor-pointer transition-all duration-150 ${
                              isActiveTask
                                ? 'sidebar-pill-active text-foreground font-medium'
                                : 'sidebar-row-hover text-muted-foreground hover:text-foreground'
                            } ${draggingTaskId === task.id ? 'opacity-40' : ''}`}
                            onClick={() => onSelectTask(project.id, task.id)}
                          >
                            <div className="flex items-center gap-2">
                              {/* Status indicator */}
                              {activityState === 'error' ? (
                                <Tooltip content={errorTooltip}>
                                  <div className="status-dot-err w-[6px] h-[6px] rounded-full flex-shrink-0" />
                                </Tooltip>
                              ) : activityState === 'waiting' ? (
                                <Tooltip content="Waiting for user">
                                  <div className="status-dot-wait w-[6px] h-[6px] rounded-full flex-shrink-0" />
                                </Tooltip>
                              ) : activityState === 'busy' ? (
                                <Tooltip content={busyTooltip}>
                                  <div className="w-[6px] h-[6px] rounded-full bg-amber-400 status-pulse flex-shrink-0" />
                                </Tooltip>
                              ) : activityState === 'idle' && unseenTaskIds?.has(task.id) ? (
                                <Tooltip content="Done (unseen)">
                                  <div className="status-dot-unseen w-[6px] h-[6px] rounded-full flex-shrink-0" />
                                </Tooltip>
                              ) : activityState === 'idle' ? (
                                <Tooltip content="Idle">
                                  <div className="status-dot-idle w-[6px] h-[6px] rounded-full flex-shrink-0" />
                                </Tooltip>
                              ) : null}
                              {remoteControlStates[task.id] && (
                                <Globe
                                  size={10}
                                  strokeWidth={2}
                                  className="text-primary flex-shrink-0 -ml-0.5"
                                />
                              )}

                              <span className="truncate flex-1">{task.name}</span>

                              {/* Context percentage (visible when data available, hidden on hover to show actions) */}
                              {ctx && ctx.percentage > 0 && (
                                <span
                                  className={`text-[9px] tabular-nums flex-shrink-0 group-hover/task:hidden ${
                                    ctx.percentage >= 80
                                      ? 'text-red-400 font-medium'
                                      : usageTextColor(ctx.percentage)
                                  }`}
                                >
                                  {Math.round(ctx.percentage)}%
                                </span>
                              )}

                              {/* Right slot: branch icon by default, actions on hover */}
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {isActiveTask && !ctx && (
                                  <GitBranch
                                    size={11}
                                    className="text-foreground/50 group-hover/task:hidden"
                                    strokeWidth={2}
                                  />
                                )}
                                <div className="hidden group-hover/task:flex gap-0.5">
                                  <IconButton
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onArchiveTask(task.id);
                                    }}
                                    title="Archive task"
                                    size="sm"
                                  >
                                    <Archive size={12} strokeWidth={1.8} />
                                  </IconButton>
                                  <IconButton
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteTask(task.id);
                                    }}
                                    title="Delete task"
                                    variant="destructive"
                                    size="sm"
                                  >
                                    <Trash2 size={12} strokeWidth={1.8} />
                                  </IconButton>
                                </div>
                              </div>
                            </div>

                            {/* Context usage bar */}
                            {ctx && ctx.percentage > 0 && (
                              <UsageBarInline
                                percentage={ctx.percentage}
                                height={2}
                                width="auto"
                                className="ml-[14px] mt-1"
                                title={`Context: ${ctx.used.toLocaleString()} / ${ctx.total.toLocaleString()} tokens (${Math.round(ctx.percentage)}%)`}
                              />
                            )}
                          </div>
                        );
                      })}

                      {projectTasks.length === 0 && isActive && (
                        <div className="px-2 py-3 text-center">
                          <p className="text-[10px] text-muted-foreground/60">No tasks yet</p>
                        </div>
                      )}

                      {/* Archived tasks drawer */}
                      {archivedTasks.length > 0 && (
                        <>
                          <button
                            onClick={() => toggleArchivedCollapse(project.id)}
                            className="flex items-center gap-1 w-full pl-3.5 pr-2 py-[5px] rounded-md text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {isArchivedCollapsed ? (
                              <ChevronRight size={12} strokeWidth={2} />
                            ) : (
                              <ChevronDown size={12} strokeWidth={2} />
                            )}
                            <span>Archived ({archivedTasks.length})</span>
                          </button>

                          <div
                            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
                            style={{
                              gridTemplateRows: isArchivedCollapsed ? '0fr' : '1fr',
                            }}
                          >
                            <div className="overflow-hidden">
                              <div className="space-y-px">
                                {archivedTasks.map((task) => (
                                  <div
                                    key={task.id}
                                    className="group/archived flex items-center gap-2 pl-3.5 pr-2 py-[6px] rounded-md text-[13px] text-muted-foreground/50"
                                  >
                                    <span className="truncate flex-1">{task.name}</span>
                                    <div className="hidden group-hover/archived:flex gap-0.5 flex-shrink-0">
                                      <IconButton
                                        onClick={() => onRestoreTask(task.id)}
                                        title="Restore task"
                                        size="sm"
                                      >
                                        <ArchiveRestore size={12} strokeWidth={1.8} />
                                      </IconButton>
                                      <IconButton
                                        onClick={() => onDeleteTask(task.id)}
                                        title="Delete task"
                                        variant="destructive"
                                        size="sm"
                                      >
                                        <Trash2 size={12} strokeWidth={1.8} />
                                      </IconButton>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Skills & Settings */}
      <div className="px-2 py-2 border-t border-border/30 space-y-0.5">
        <button
          onClick={onOpenSkillsBrowser}
          className="flex items-center gap-2 px-2.5 py-[7px] w-full rounded-md text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-150 titlebar-no-drag"
        >
          <Blocks size={14} strokeWidth={1.8} />
          <span>Skills</span>
        </button>
        <button
          onClick={onOpenSettings}
          className="settings-btn flex items-center gap-2 px-2.5 py-[7px] w-full rounded-md text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-150 titlebar-no-drag"
        >
          <Settings size={14} strokeWidth={1.8} />
          <span>Settings</span>
          {pixelAgentsConnectedCount > 0 && (
            <Tooltip content="Pixel Agents streaming to office">
              <span
                className="ml-auto flex items-center gap-1.5 text-[12px] text-[hsl(var(--git-added))] hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPixelAgents?.();
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--git-added))] flex-shrink-0" />
                <span className="office-label">
                  {pixelAgentsConnectedCount === 1
                    ? '1 office'
                    : `${pixelAgentsConnectedCount} offices`}
                </span>
                <span className="office-count">{pixelAgentsConnectedCount}</span>
              </span>
            </Tooltip>
          )}
        </button>
      </div>
    </div>
  );
}
