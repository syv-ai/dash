import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  ArchiveRestore,
  Settings,
  GitGraph,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import type {
  Project,
  Task,
  RemoteControlState,
  ContextUsage,
  ActivityInfo,
} from '../../../shared/types';
import { useDragReorder } from '../../hooks/useDragReorder';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { formatTokens, formatCost } from '../../utils/formatTokens';
import { TaskCard } from './TaskCard';
import { useSettings } from '../../stores/settingsStore';

interface ProjectsSectionProps {
  projects: Project[];
  activeProjectId: string | null;
  tasksByProject: Record<string, Task[]>;
  activeTaskId: string | null;
  taskActivity: Record<string, ActivityInfo>;
  unseenTaskIds?: Set<string>;
  remoteControlStates: Record<string, RemoteControlState>;
  contextUsage: Record<string, ContextUsage>;
  projectTokenStats: Record<
    string,
    { totalTokens: number; totalCostUsd: number; taskCount: number }
  >;
  onSelectProject: (id: string) => void;
  onOpenFolder: () => void;
  onDeleteProject: (id: string) => void;
  onProjectSettings: (id: string) => void;
  onShowCommitGraph: (projectId: string) => void;
  onSelectTask: (projectId: string, taskId: string) => void;
  onNewTask: (projectId: string) => void;
  onDeleteTask: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onRestoreTask: (id: string) => void;
  onCloseTask: (id: string) => void;
  onTaskSettings: (id: string) => void;
  onReorderProjects?: (reordered: Project[]) => void;
  onReorderTasks?: (projectId: string, reordered: Task[]) => void;
  onReorderTasksCommit?: (projectId: string, reordered: Task[]) => void;
}

/** Expanded-sidebar "Projects" list: project rows, their task trees, and
 *  the per-project archived drawer. Owns expand/collapse and drag state. */
export function ProjectsSection({
  projects,
  activeProjectId,
  tasksByProject,
  activeTaskId,
  taskActivity,
  unseenTaskIds,
  remoteControlStates,
  contextUsage,
  projectTokenStats,
  onSelectProject,
  onOpenFolder,
  onDeleteProject,
  onProjectSettings,
  onShowCommitGraph,
  onSelectTask,
  onNewTask,
  onDeleteTask,
  onArchiveTask,
  onRestoreTask,
  onCloseTask,
  onTaskSettings,
  onReorderProjects,
  onReorderTasks,
  onReorderTasksCommit,
}: ProjectsSectionProps) {
  const showProjectTokens = useSettings((s) => s.showProjectTokens);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('expandedProjects');
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return new Set(parsed.filter((v): v is string => typeof v === 'string'));
      return new Set();
    } catch (err) {
      console.warn('Failed to parse expandedProjects from localStorage, resetting:', err);
      localStorage.removeItem('expandedProjects');
      return new Set();
    }
  });
  useEffect(() => {
    localStorage.setItem('expandedProjects', JSON.stringify([...expandedProjects]));
  }, [expandedProjects]);
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
    setExpandedProjects((prev) => {
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

  return (
    <div className="flex-1 min-h-0 flex flex-col mr-[5px]">
      <div className="flex items-center justify-between pl-4 pr-1.5 pt-1.5 pb-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 select-none">
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
      <div className="scrollbar-thin-hover flex-1 min-h-0 overflow-y-auto pl-2 pb-2">
        {projects.length === 0 && (
          <div className="px-2 py-10 text-center">
            <p className="text-[13px] text-muted-foreground/40 leading-relaxed">
              Open a folder to get started
            </p>
          </div>
        )}

        <div>
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isProjectCollapsed = !expandedProjects.has(project.id);
            const allTasks = tasksByProject[project.id] || [];
            const projectTasks = allTasks.filter((t) => !t.archivedAt);
            const archivedTasks = allTasks.filter((t) => t.archivedAt);
            const isArchivedCollapsed = !collapsedArchived.has(project.id);
            const hasActiveTask = projectTasks.some((t) => !!taskActivity[t.id]?.state);

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
                    if (!expandedProjects.has(project.id)) {
                      toggleCollapse(project.id);
                    }
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(project.id);
                    }}
                    className={`p-0.5 rounded flex-shrink-0 hover:text-foreground transition-colors ${
                      isProjectCollapsed ? 'text-muted-foreground/60' : ''
                    }`}
                  >
                    {isProjectCollapsed ? (
                      <ChevronRight size={14} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={14} strokeWidth={2} />
                    )}
                  </button>

                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {(() => {
                      const stats = projectTokenStats[project.id];
                      const nameSpan = (
                        <span
                          className={`truncate flex-1 min-w-0 ${
                            isProjectCollapsed && !hasActiveTask ? 'opacity-50' : ''
                          }`}
                        >
                          {project.name}
                        </span>
                      );
                      if (!showProjectTokens || !stats || stats.totalTokens === 0) {
                        return nameSpan;
                      }
                      const tip = `${formatTokens(stats.totalTokens)} tokens · ${formatCost(
                        stats.totalCostUsd,
                      )} across ${stats.taskCount} task${stats.taskCount === 1 ? '' : 's'}`;
                      return <Tooltip content={tip}>{nameSpan}</Tooltip>;
                    })()}
                    {isProjectCollapsed && hasActiveTask && (
                      <Tooltip content="Active task in this project">
                        <div className="status-dot-idle w-[6px] h-[6px] rounded-full flex-shrink-0" />
                      </Tooltip>
                    )}
                  </div>

                  {projectTasks.length > 0 && (
                    <span
                      className={`text-xs text-muted-foreground tabular-nums flex-shrink-0 mr-0.5 leading-none group-hover:invisible ${
                        isProjectCollapsed ? 'opacity-50' : ''
                      }`}
                    >
                      {projectTasks.length}
                    </span>
                  )}

                  {/* Action buttons — overlay from right on hover. The 24px
                    fade region matches `pl-6`, so the gradient is fully
                    opaque under the buttons (masking truncated titles) and
                    transparent to their left (no visible box edge). */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 pl-6 bg-[linear-gradient(to_right,transparent,hsl(var(--surface-1))_24px)]">
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
                    <div className="ml-4 mr-1 mt-0.5 pb-4 space-y-px">
                      {projectTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          isActive={task.id === activeTaskId}
                          activityInfo={taskActivity[task.id]}
                          ctx={contextUsage[task.id]}
                          isUnseen={!!unseenTaskIds?.has(task.id)}
                          hasRemoteControl={!!remoteControlStates[task.id]}
                          isDragging={draggingTaskId === task.id}
                          dragHandlers={getTaskDragHandlers(task.id, projectTasks, project.id)}
                          onSelect={() => onSelectTask(project.id, task.id)}
                          onClose={() => onCloseTask(task.id)}
                          onSettings={() => onTaskSettings(task.id)}
                          onArchive={() => onArchiveTask(task.id)}
                          onDelete={() => onDeleteTask(task.id)}
                        />
                      ))}

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
                                    <span className="truncate flex-1 min-w-0">{task.name}</span>
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
    </div>
  );
}
