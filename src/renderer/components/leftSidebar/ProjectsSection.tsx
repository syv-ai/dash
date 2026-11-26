import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Archive,
  ArchiveRestore,
  Settings,
  GitGraph,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Brain,
  FolderPlus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import type { Project, Task } from '../../../shared/types';
import { useDragReorder } from '../../hooks/useDragReorder';
import { IconButton } from '../ui/IconButton';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { ListRow } from '../ui/ListRow';
import { StatusDot } from '../ui/StatusDot';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/Tooltip';
import { CountBadge } from '../ui/CountBadge';
import { formatTokens, formatCost } from '../../utils/format';
import { TaskCard } from './TaskCard';
import { ForeignSessionsSection } from './ForeignSessionsSection';
import { Disclosure } from './Disclosure';
import { getProjectActivity, projectActivityDot } from './projectActivity';
import { newMemoriesLabel } from '../memory/memoryView';
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
  const newMemoryCounts = useRuntime((s) => s.newMemoryCounts);
  const remoteControlStates = useRuntime((s) => s.remoteControlStates);
  const justCreatedProjectId = useProjects((s) => s.justCreatedProjectId);
  const clearJustCreatedProject = useProjects((s) => s.clearJustCreatedProject);
  const archivedProjects = useProjects((s) => s.archivedProjects);
  const archiveProject = useProjects((s) => s.archiveProject);
  const restoreProject = useProjects((s) => s.restoreProject);
  const [archivedProjectsOpen, setArchivedProjectsOpen] = useState(false);
  const newRowRef = useRef<HTMLDivElement | null>(null);
  const prByTask = useGit((s) => s.prByTask);
  const branchPrsByTask = useGit((s) => s.branchPrsByTask);
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
  // Projects whose archived-tasks list is open.
  const [openArchived, setOpenArchived] = useState<Set<string>>(new Set());
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

  function toggleArchived(projectId: string) {
    setOpenArchived((prev) => {
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
    <div className="scrollbar-thin-hover flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1 pb-3">
      {projects.length === 0 && (
        <EmptyState
          icon={<FolderPlus size={14} strokeWidth={1.8} />}
          title="Add a project to start"
          action={
            <Button size="sm" variant="secondary" onClick={onOpenFolder}>
              Add project
            </Button>
          }
        />
      )}

      {projects.map((project) => {
        const isActive = project.id === activeProjectId;
        const isProjectCollapsed = !expandedProjects.has(project.id);
        const allTasks = tasksByProject[project.id] || [];
        const projectTasks = allTasks.filter((t) => !t.archivedAt);
        const archivedTasks = allTasks.filter((t) => t.archivedAt);
        const activityDot = projectActivityDot(getProjectActivity(projectTasks, taskActivity));
        const stats = projectTokenStats[project.id];
        const tokenTip =
          showProjectTokens && stats && stats.totalTokens > 0
            ? `${formatTokens(stats.totalTokens)} tokens · ${formatCost(stats.totalCostUsd)} across ${
                stats.taskCount
              } task${stats.taskCount === 1 ? '' : 's'}`
            : null;

        return (
          <div key={project.id} ref={project.id === justCreatedProjectId ? newRowRef : undefined}>
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
              className={cn('group/swap', draggingId === project.id && 'opacity-40')}
            >
              <ListRow
                as="div"
                role="button"
                tabIndex={0}
                aria-expanded={!isProjectCollapsed}
                dimmed={!isActive && isProjectCollapsed && !activityDot}
                onClick={() => {
                  onSelectProject(project.id);
                  if (isProjectCollapsed) toggleCollapse(project.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectProject(project.id);
                    toggleCollapse(project.id);
                  }
                }}
                leading={
                  <IconButton
                    size="sm"
                    title={isProjectCollapsed ? 'Expand' : 'Collapse'}
                    className="-ml-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(project.id);
                    }}
                  >
                    {isProjectCollapsed ? (
                      <ChevronRight size={14} strokeWidth={1.8} />
                    ) : (
                      <ChevronDown size={14} strokeWidth={1.8} />
                    )}
                  </IconButton>
                }
                trailing={
                  <>
                    <NewMemoryCount
                      count={newMemoryCounts[project.id] ?? 0}
                      onOpen={() => setMemoryProjectId(project.id)}
                    />
                    {/* Dot and task count at rest; on hover (or while its menu
                          is open) "New task" and a "…" menu slide in over them. */}
                    <HoverSwapSlot
                      revealed={menuOpenProjectId === project.id}
                      rest={
                        <>
                          <span className="flex w-2.5 items-center justify-center">
                            {isProjectCollapsed && activityDot && (
                              <StatusDot state={activityDot.state} label={activityDot.label} />
                            )}
                          </span>
                          <span className="w-4 text-right text-xs tabular-nums">
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
                            <Plus size={14} strokeWidth={1.8} />
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
                                <MoreHorizontal size={14} strokeWidth={1.8} />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem onSelect={() => onShowCommitGraph(project.id)}>
                                <GitGraph size={13} strokeWidth={1.8} />
                                Commit graph
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => onProjectSettings(project.id)}>
                                <Settings size={13} strokeWidth={1.8} />
                                Project settings
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setMemoryProjectId(project.id)}>
                                <Brain size={13} strokeWidth={1.8} />
                                Claude memory
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void archiveProject(project.id)}>
                                <Archive size={13} strokeWidth={1.8} />
                                Archive project
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => onDeleteProject(project.id)}
                              >
                                <Trash2 size={13} strokeWidth={1.8} />
                                Delete project
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      }
                    />
                  </>
                }
              >
                {tokenTip ? (
                  <Tooltip content={tokenTip}>
                    <span>{project.name}</span>
                  </Tooltip>
                ) : (
                  project.name
                )}
              </ListRow>
            </div>

            {/* Tasks nested under the project */}
            <div className="collapse-grid" data-open={!isProjectCollapsed}>
              <div>
                <div className="flex flex-col gap-px pt-px pb-3 pl-4">
                  {projectTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      isActive={task.id === activeTaskId}
                      activityInfo={taskActivity[task.id]}
                      prs={prByTask[task.id]}
                      allPrs={branchPrsByTask[task.id]}
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

                  {projectTasks.length === 0 && isActive && <EmptyState title="No tasks yet" />}

                  {/* Sessions in this project that no task owns */}
                  <ForeignSessionsSection project={project} onSelectTask={onSelectTask} />

                  {archivedTasks.length > 0 && (
                    <Disclosure
                      label={`Archived (${archivedTasks.length})`}
                      open={openArchived.has(project.id)}
                      onToggle={() => toggleArchived(project.id)}
                    >
                      {archivedTasks.map((task) => (
                        <ArchivedRow
                          key={task.id}
                          name={task.name}
                          kind="task"
                          onRestore={() => onRestoreTask(task.id)}
                          onDelete={() => onDeleteTask(task.id)}
                        />
                      ))}
                    </Disclosure>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {archivedProjects.length > 0 && (
        <Disclosure
          label={`Archived projects (${archivedProjects.length})`}
          open={archivedProjectsOpen}
          onToggle={() => setArchivedProjectsOpen((v) => !v)}
        >
          {archivedProjects.map((project) => (
            <ArchivedRow
              key={project.id}
              name={project.name}
              kind="project"
              onRestore={() => void restoreProject(project.id)}
              onDelete={() => onDeleteProject(project.id)}
            />
          ))}
        </Disclosure>
      )}
    </div>
  );
}

/** An archived task or project: its name, with restore and delete on hover. */
function ArchivedRow({
  name,
  kind,
  onRestore,
  onDelete,
}: {
  name: string;
  kind: 'task' | 'project';
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/archived">
      <ListRow
        as="div"
        size="sm"
        dimmed
        trailing={
          <span className="hidden gap-0.5 group-hover/archived:flex">
            <IconButton onClick={onRestore} title={`Restore ${kind}`} size="sm">
              <ArchiveRestore size={13} strokeWidth={1.8} />
            </IconButton>
            <IconButton onClick={onDelete} title={`Delete ${kind}`} variant="destructive" size="sm">
              <Trash2 size={13} strokeWidth={1.8} />
            </IconButton>
          </span>
        }
      >
        {name}
      </ListRow>
    </div>
  );
}

/**
 * A count after the project name while Claude has written memories since the
 * project's memory was last opened. Clicking it opens the memory, which clears it.
 */
function NewMemoryCount({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <Tooltip content={newMemoriesLabel(count)} delay={300}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={newMemoriesLabel(count)}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <CountBadge count={count} />
      </Button>
    </Tooltip>
  );
}
