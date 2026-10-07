import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ArchiveRestore,
  Settings,
  GitGraph,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Brain,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import type { Project, Task, ContextUsage } from '../../../shared/types';
import { useDragReorder } from '../../hooks/useDragReorder';
import { IconButton } from '../ui/IconButton';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { Tooltip } from '../ui/Tooltip';
import { formatTokens, formatCost } from '../../utils/format';
import { TaskCard } from './TaskCard';
import { ForeignSessionsSection } from './ForeignSessionsSection';
import { SlidingPill, useSlidingPill } from './useSlidingPill';
import { openInIde } from '../../lib/openInIde';
import { useSettings } from '../../stores/settingsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { useProjects } from '../../stores/projectsStore';
import { useGit } from '../../stores/gitStore';
import { useUi } from '../../stores/uiStore';

/** How often the sidebar re-checks visible tasks for PRs. */
const SIDEBAR_PR_REFRESH_MS = 5 * 60_000;

interface ProjectsSectionProps {
  projects: Project[];
  activeProjectId: string | null;
  tasksByProject: Record<string, Task[]>;
  activeTaskId: string | null;
  unseenTaskIds?: Set<string>;
  contextUsage: Record<string, ContextUsage>;
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
  unseenTaskIds,
  contextUsage,
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
  const projectTokenStats = useRuntime((s) => s.projectTokenStats);
  const taskActivity = useRuntime((s) => s.taskActivity);
  const remoteControlStates = useRuntime((s) => s.remoteControlStates);
  const justCreatedProjectId = useProjects((s) => s.justCreatedProjectId);
  const clearJustCreatedProject = useProjects((s) => s.clearJustCreatedProject);
  const newRowRef = useRef<HTMLDivElement | null>(null);
  const prByTask = useGit((s) => s.prByTask);
  const detectProjectPrs = useGit((s) => s.detectProjectPrs);
  const setMemoryProjectId = useUi((s) => s.setMemoryProjectId);

  // One-shot: scroll the freshly-created project's row into view, then clear the
  // signal so we never scroll again on unrelated re-renders.
  useEffect(() => {
    if (!justCreatedProjectId) return;
    newRowRef.current?.scrollIntoView({ block: 'nearest' });
    clearJustCreatedProject();
  }, [justCreatedProjectId, clearJustCreatedProject]);
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

  // Look up each visible task's PR so the row can link to it. Keyed on a
  // branch signature of the expanded projects (not the arrays) so routine
  // store updates don't re-spam gh/ado; refreshed on a slow interval so a PR
  // opened later still shows up. The active task's own poll (gitStore.detectPr)
  // keeps its entry fresher.
  const prSig = projects
    .filter((p) => expandedProjects.has(p.id))
    .map(
      (p) =>
        `${p.id}=` +
        (tasksByProject[p.id] || [])
          .filter((t) => !t.archivedAt)
          .map((t) => `${t.id}:${t.branch}`)
          .join(','),
    )
    .join('|');
  useEffect(() => {
    const run = () => {
      for (const project of projects) {
        if (!expandedProjects.has(project.id)) continue;
        const tasks = (tasksByProject[project.id] || []).filter((t) => !t.archivedAt);
        if (tasks.length > 0) void detectProjectPrs(project, tasks);
      }
    };
    run();
    const interval = setInterval(run, SIDEBAR_PR_REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prSig, detectProjectPrs]);
  const [collapsedArchived, setCollapsedArchived] = useState<Set<string>>(new Set());
  // Project whose "…" menu is open: its toolbar stays revealed off-hover.
  const [menuOpenProjectId, setMenuOpenProjectId] = useState<string | null>(null);
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

  // One selection pill for the whole tree: it slides between projects, and
  // fades out while the selected task's project is collapsed.
  const activeTaskProjectId = activeTaskId
    ? Object.keys(tasksByProject).find((pid) =>
        tasksByProject[pid]?.some((t) => t.id === activeTaskId && !t.archivedAt),
      )
    : undefined;
  const pillHidden = !!activeTaskProjectId && !expandedProjects.has(activeTaskProjectId);
  const treeLayout = useMemo(
    () => [projects, tasksByProject, expandedProjects, collapsedArchived],
    [projects, tasksByProject, expandedProjects, collapsedArchived],
  );
  const {
    containerRef: treeRef,
    setRow: setTaskRow,
    pill,
  } = useSlidingPill(activeTaskId, pillHidden, treeLayout);

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
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-fade-70 select-none">
          Projects
        </span>
        <Tooltip content="Create project">
          <button
            onClick={onOpenFolder}
            className="p-[3px] rounded text-muted-fade-60 hover:text-foreground hover:bg-foreground/5 transition-colors titlebar-no-drag"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </Tooltip>
      </div>
      <div className="scrollbar-thin-hover flex-1 min-h-0 overflow-y-auto pl-2 pb-2">
        {projects.length === 0 && (
          <div className="px-2 py-10 text-center">
            <p className="text-[13px] text-muted-fade-40 leading-relaxed">
              Open a folder to get started
            </p>
          </div>
        )}

        <div ref={treeRef} className="relative isolate">
          <SlidingPill pill={pill} />
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isProjectCollapsed = !expandedProjects.has(project.id);
            const allTasks = tasksByProject[project.id] || [];
            const projectTasks = allTasks.filter((t) => !t.archivedAt);
            const archivedTasks = allTasks.filter((t) => t.archivedAt);
            const isArchivedCollapsed = !collapsedArchived.has(project.id);
            const hasActiveTask = projectTasks.some((t) => !!taskActivity[t.id]?.state);

            return (
              <div
                key={project.id}
                ref={project.id === justCreatedProjectId ? newRowRef : undefined}
              >
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
                    reordered.splice(toIdx, 0, moved!);
                    onReorderProjects?.(reordered);
                  }}
                  onDrop={(e) => e.preventDefault()}
                  onDragEnd={() => {
                    dragIdRef.current = null;
                    setDraggingId(null);
                  }}
                  className={`group/swap relative flex items-center gap-1.5 px-2 h-8 rounded-md text-sm cursor-pointer transition-transform duration-200 ease-in-out ${
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
                    className={`p-0.5 rounded shrink-0 hover:text-foreground transition-colors ${
                      isProjectCollapsed ? 'text-muted-fade-60' : ''
                    }`}
                  >
                    {isProjectCollapsed ? (
                      <ChevronRight size={14} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={14} strokeWidth={2} />
                    )}
                  </button>

                  {/* Three columns — name, orb, count — at the same x on every
                      project row: the orb and count keep their width even when
                      empty. */}
                  <div className="flex items-center min-w-0 flex-1">
                    {(() => {
                      const stats = projectTokenStats[project.id];
                      const nameSpan = (
                        <span
                          className={`truncate flex-1 min-w-0 ${
                            isProjectCollapsed && !hasActiveTask ? 'fade-50' : ''
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
                  </div>

                  {/* Orb and task count at rest; on hover (or while its menu is
                      open) "New task" plus a "…" menu slide in across them. */}
                  <HoverSwapSlot
                    revealed={menuOpenProjectId === project.id}
                    rest={
                      <>
                        <span className="flex items-center justify-center w-2.5">
                          {isProjectCollapsed && hasActiveTask && (
                            <Tooltip content="Active task in this project">
                              <div className="status-dot-idle w-[6px] h-[6px] rounded-full shrink-0" />
                            </Tooltip>
                          )}
                        </span>
                        <span
                          className={`w-4 text-right text-xs text-muted-foreground tabular-nums leading-none ${
                            isProjectCollapsed ? 'fade-50' : ''
                          }`}
                        >
                          {projectTasks.length > 0 ? projectTasks.length : ''}
                        </span>
                      </>
                    }
                    actions={
                      <>
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
                        <DropdownMenu
                          onOpenChange={(open) => setMenuOpenProjectId(open ? project.id : null)}
                        >
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              onClick={(e) => e.stopPropagation()}
                              title="More actions"
                              size="sm"
                            >
                              <MoreHorizontal size={13} strokeWidth={1.8} />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="min-w-40"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenuItem onSelect={() => onShowCommitGraph(project.id)}>
                              <GitGraph
                                size={13}
                                strokeWidth={2}
                                className="text-muted-foreground"
                              />
                              Commit graph
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onProjectSettings(project.id)}>
                              <Settings
                                size={13}
                                strokeWidth={1.8}
                                className="text-muted-foreground"
                              />
                              Project settings
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setMemoryProjectId(project.id)}>
                              <Brain
                                size={13}
                                strokeWidth={1.8}
                                className="text-muted-foreground"
                              />
                              Claude memory
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => onDeleteProject(project.id)}
                              className="text-destructive focus:bg-destructive/10 data-highlighted:bg-destructive/10"
                            >
                              <Trash2 size={13} strokeWidth={1.8} />
                              Delete project
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                  />
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
                          rowRef={(el) => setTaskRow(task.id, el)}
                          task={task}
                          isActive={task.id === activeTaskId}
                          activityInfo={taskActivity[task.id]}
                          ctx={contextUsage[task.id]}
                          prInfo={prByTask[task.id] ?? null}
                          isUnseen={!!unseenTaskIds?.has(task.id)}
                          hasRemoteControl={!!remoteControlStates[task.id]}
                          isDragging={draggingTaskId === task.id}
                          dragHandlers={getTaskDragHandlers(task.id, projectTasks, project.id)}
                          onSelect={() => onSelectTask(project.id, task.id)}
                          onOpenIde={() => void openInIde(task.path || project.path)}
                          onClose={() => onCloseTask(task.id)}
                          onSettings={() => onTaskSettings(task.id)}
                          onArchive={() => onArchiveTask(task.id)}
                          onDelete={() => onDeleteTask(task.id)}
                        />
                      ))}

                      {projectTasks.length === 0 && isActive && (
                        <div className="px-2 py-3 text-center">
                          <p className="text-[10px] text-muted-fade-60">No tasks yet</p>
                        </div>
                      )}

                      {/* Sessions in this project that no task owns */}
                      <ForeignSessionsSection project={project} onSelectTask={onSelectTask} />

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
                                    className="group/archived flex items-center gap-2 pl-3.5 pr-2 py-[6px] rounded-md text-[13px] text-muted-fade-50"
                                  >
                                    <span className="truncate flex-1 min-w-0">{task.name}</span>
                                    <div className="hidden group-hover/archived:flex gap-0.5 shrink-0">
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
