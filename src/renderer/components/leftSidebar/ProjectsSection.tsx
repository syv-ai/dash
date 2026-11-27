import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, ArchiveRestore, MoreHorizontal, FolderPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import type { MenuParts } from '../task/TaskMenuItems';
import { ProjectMenuItems } from './ProjectMenuItems';
import type { ContextUsage, Project, Task } from '../../../shared/types';
import { useDragReorder } from '../../hooks/useDragReorder';
import { IconButton } from '../ui/IconButton';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import {
  BranchChevron,
  Tree,
  TreeRow,
  ownNode,
  type TreeHandle,
  type TreeRowContext,
} from '../ui/Tree';
import { StatusDot } from '../ui/StatusDot';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { CountBadge } from '../ui/CountBadge';
import { formatTokens, formatCost } from '../../utils/format';
import { TaskCard, TASK_INDENT_PX } from './TaskCard';
import { ForeignSessionsSection } from './ForeignSessionsSection';
import { foreignSessionsFor, taskOwnership } from './foreignSessions';
import { projectTreeRows, type ProjectTreeRow } from './projectTree';
import { getProjectActivity, projectActivityDot } from './projectActivity';
import { agentState } from './taskStates';
import { newMemoriesLabel } from '../memory/memoryView';
import { showProjectMemory } from '../memory/showMemory';
import { openInIde } from '../../lib/openInIde';
import { useSettings } from '../../stores/settingsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { useProjects } from '../../stores/projectsStore';
import { useGit } from '../../stores/gitStore';

const DROPDOWN_PARTS: MenuParts = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator };
const CONTEXT_PARTS: MenuParts = { Item: ContextMenuItem, Separator: ContextMenuSeparator };

/** How often the sidebar re-checks visible tasks for PRs. */
const SIDEBAR_PR_REFRESH_MS = 5 * 60_000;

interface ProjectsSectionProps {
  projects: Project[];
  activeProjectId: string | null;
  tasksByProject: Record<string, Task[]>;
  activeTaskId: string | null;
  unseenTaskIds?: Set<string>;
  /** Each live task's session context (the right sidebar's Session level). */
  contextUsage?: Record<string, ContextUsage>;
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
  const newMemoryCounts = useRuntime((s) => s.newMemoryCounts);
  const supervisorSessions = useRuntime((s) => s.supervisorSessions);
  // Derive from the stable map reference (see the useShallow caveat in CLAUDE.md).
  const owned = useMemo(() => taskOwnership(tasksByProject), [tasksByProject]);
  const justCreatedProjectId = useProjects((s) => s.justCreatedProjectId);
  const clearJustCreatedProject = useProjects((s) => s.clearJustCreatedProject);
  const archivedProjects = useProjects((s) => s.archivedProjects);
  const archiveProject = useProjects((s) => s.archiveProject);
  const restoreProject = useProjects((s) => s.restoreProject);
  const [archivedProjectsOpen, setArchivedProjectsOpen] = useState(false);
  const detectProjectPrs = useGit((s) => s.detectProjectPrs);

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

  const rows = projectTreeRows({
    projects,
    tasksByProject,
    activeProjectId,
    expanded: expandedProjects,
    openArchived,
    archivedProjects,
    archivedProjectsOpen,
    hasOtherSessions: (project) =>
      foreignSessionsFor(project, supervisorSessions, owned).length > 0,
  });

  // One-shot: scroll the freshly-created project's row into view, then clear
  // the signal so we never scroll again on unrelated re-renders.
  const treeRef = useRef<TreeHandle>(null);
  const newRowIndex = justCreatedProjectId
    ? rows.findIndex((r) => r.kind === 'project' && r.project.id === justCreatedProjectId)
    : -1;
  useEffect(() => {
    if (!justCreatedProjectId) return;
    if (newRowIndex >= 0) treeRef.current?.scrollToRow(newRowIndex);
    clearJustCreatedProject();
  }, [justCreatedProjectId, newRowIndex, clearJustCreatedProject]);

  /** A project row drags to reorder the projects, previewing on every pass. */
  const projectDrag = (project: Project) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent<HTMLElement>) => {
      dragIdRef.current = project.id;
      setDraggingId(project.id);
      e.dataTransfer.effectAllowed = 'move';
      const el = e.currentTarget;
      e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
    },
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
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
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
    onDragEnd: () => {
      dragIdRef.current = null;
      setDraggingId(null);
    },
  });

  const renderProject = (
    row: Extract<ProjectTreeRow, { kind: 'project' }>,
    ctx: TreeRowContext,
  ) => {
    const { project, tasks: projectTasks } = row;
    const isActive = project.id === activeProjectId;
    const isProjectCollapsed = !row.open;
    const activityDot = projectActivityDot(getProjectActivity(projectTasks, taskActivity));
    const stats = projectTokenStats[project.id];
    const tokenTip =
      showProjectTokens && stats && stats.totalTokens > 0
        ? `${formatTokens(stats.totalTokens)} tokens · ${formatCost(stats.totalCostUsd)} across ${
            stats.taskCount
          } task${stats.taskCount === 1 ? '' : 's'}`
        : null;
    const menu = {
      project,
      onShowCommitGraph: () => onShowCommitGraph(project.id),
      onSettings: () => onProjectSettings(project.id),
      onOpenMemory: () => showProjectMemory(project.id),
      onArchive: () => void archiveProject(project.id),
      onDelete: () => onDeleteProject(project.id),
    };
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TreeRow
            ctx={ctx}
            {...projectDrag(project)}
            // 32px, the file tree's rhythm: a list of closed projects reads
            // as one block, the name keeps the row's 13px (T25).
            className="group/swap h-8"
            dragging={draggingId === project.id}
            dimmed={!isActive && isProjectCollapsed && !activityDot}
            strong={isActive}
            // A click selects and opens; Enter or Space selects and toggles.
            onActivate={(e) => {
              onSelectProject(project.id);
              if (e.type !== 'click' || isProjectCollapsed) toggleCollapse(project.id);
            }}
            leading={
              <IconButton
                size="sm"
                title={isProjectCollapsed ? 'Expand' : 'Collapse'}
                className="-ml-1.5"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse(project.id);
                }}
              >
                <BranchChevron open={!isProjectCollapsed} />
              </IconButton>
            }
            trailing={
              <>
                <NewMemoryCount
                  count={newMemoryCounts[project.id] ?? 0}
                  onOpen={() => showProjectMemory(project.id)}
                />
                {/* The dot at rest; on hover (or while its menu is open)
                  "New task" and a "…" menu slide in over it. */}
                <HoverSwapSlot
                  revealed={menuOpenProjectId === project.id}
                  rest={
                    <span className="flex w-2.5 items-center justify-center">
                      {isProjectCollapsed && activityDot && (
                        <StatusDot size="sm" state={activityDot.state} label={activityDot.label} />
                      )}
                    </span>
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
                          <ProjectMenuItems {...menu} parts={DROPDOWN_PARTS} />
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
          </TreeRow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ProjectMenuItems
            {...menu}
            parts={CONTEXT_PARTS}
            onNewTask={() => onNewTask(project.id)}
          />
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderRow = (row: ProjectTreeRow, ctx: TreeRowContext) => {
    switch (row.kind) {
      case 'noProjects':
        return (
          <EmptyState
            icon={<FolderPlus size={14} strokeWidth={1.8} />}
            title="Add a project to start"
            action={
              <Button size="sm" variant="secondary" onClick={onOpenFolder}>
                Add project
              </Button>
            }
          />
        );
      case 'project':
        return renderProject(row, ctx);
      case 'task': {
        const { task, project } = row;
        return (
          <TaskCard
            task={task}
            ctx={ctx}
            state={agentState(taskActivity[task.id], !!unseenTaskIds?.has(task.id))}
            usage={contextUsage?.[task.id]}
            indentStep={TASK_INDENT_PX}
            drag={{
              isDragging: draggingTaskId === task.id,
              handlers: getTaskDragHandlers(task.id, row.siblings, project.id),
            }}
            onSelect={() => onSelectTask(project.id, task.id)}
            onOpenIde={() => void openInIde(task.path || project.path)}
            onClose={() => onCloseTask(task.id)}
            onSettings={() => onTaskSettings(task.id)}
            onArchive={() => onArchiveTask(task.id)}
            onDelete={() => onDeleteTask(task.id)}
          />
        );
      }
      case 'empty':
        // pl-2.5: TASK_INDENT_PX in, like the project's tasks.
        return (
          <div className="pl-2.5">
            <EmptyState title="No tasks yet" />
          </div>
        );
      case 'sessions':
        // Sessions in this project that no task owns: their own disclosure.
        return (
          <div className="pl-2.5">
            <ForeignSessionsSection project={row.project} onSelectTask={onSelectTask} />
          </div>
        );
      case 'archived':
        return (
          <TreeRow
            ctx={ctx}
            indentStep={TASK_INDENT_PX}
            size="sm"
            dimmed
            onActivate={() => toggleArchived(row.project.id)}
          >
            {`Archived (${row.tasks.length})`}
          </TreeRow>
        );
      case 'archivedTask':
        return (
          <ArchivedRow
            ctx={ctx}
            name={row.task.name}
            kind="task"
            onRestore={() => onRestoreTask(row.task.id)}
            onDelete={() => onDeleteTask(row.task.id)}
          />
        );
      case 'archivedProjects':
        return (
          <TreeRow ctx={ctx} size="sm" dimmed onActivate={() => setArchivedProjectsOpen((v) => !v)}>
            {`Archived projects (${row.projects.length})`}
          </TreeRow>
        );
      case 'archivedProject':
        return (
          <ArchivedRow
            ctx={ctx}
            name={row.project.name}
            kind="project"
            onRestore={() => void restoreProject(row.project.id)}
            onDelete={() => onDeleteProject(row.project.id)}
          />
        );
      case 'gap':
        return <div className="h-3" />;
    }
  };

  return (
    <Tree
      aria-label="Projects"
      rows={rows}
      nodeOf={ownNode}
      handleRef={treeRef}
      variant="sidebar"
      className="min-h-0 flex-1"
      isSelected={(row) => row.kind === 'task' && row.task.id === activeTaskId}
      onToggle={(row) => {
        if (row.kind === 'project') toggleCollapse(row.project.id);
        else if (row.kind === 'archived') toggleArchived(row.project.id);
        else if (row.kind === 'archivedProjects') setArchivedProjectsOpen((v) => !v);
      }}
      estimateSize={estimate}
      renderRow={renderRow}
    />
  );
}

/** A row's height before it is measured. */
function estimate(row: ProjectTreeRow): number {
  switch (row.kind) {
    case 'project':
      return 32;
    case 'task':
      return 36;
    case 'gap':
      return 12;
    case 'noProjects':
    case 'empty':
      return 96;
    case 'sessions':
      return 32;
    default:
      return 32;
  }
}

/** An archived task or project: its name, with restore and delete on hover. */
function ArchivedRow({
  ctx,
  name,
  kind,
  onRestore,
  onDelete,
}: {
  ctx: TreeRowContext;
  name: string;
  kind: 'task' | 'project';
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <TreeRow
      ctx={ctx}
      indentStep={TASK_INDENT_PX}
      size="sm"
      dimmed
      className="group/archived"
      onActivate={() => {}}
      trailing={
        <span className="hidden gap-0.5 group-hover/archived:flex group-focus-within/archived:flex">
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
    </TreeRow>
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
