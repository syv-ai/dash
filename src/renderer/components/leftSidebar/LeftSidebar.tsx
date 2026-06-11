import { useState, useRef } from 'react';
import { Plus, Settings, Blocks } from 'lucide-react';
import type {
  Project,
  Task,
  RemoteControlState,
  ContextUsage,
  ActivityInfo,
} from '../../../shared/types';
import { Tooltip } from '../ui/Tooltip';
import { RotationSection } from './RotationSection';
import { ProjectsSection } from './ProjectsSection';
import { useSettings } from '../../stores/settingsStore';
import { getProjectActivity } from './projectActivity';

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
  onCloseTask: (id: string) => void;
  onTaskSettings: (id: string) => void;
  onOpenSettings: () => void;
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
  rotationTasks?: Task[];
  onReorderRotation?: (reordered: Task[]) => void;
  onRemoveFromRotation?: (taskId: string) => void;
  onToggleActiveTasksSection?: () => void;
  onOpenSkillsBrowser?: () => void;
  projectTokenStats?: Record<
    string,
    { totalTokens: number; totalCostUsd: number; taskCount: number }
  >;
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
  onCloseTask,
  onTaskSettings,
  onOpenSettings,
  onShowCommitGraph,
  collapsed,
  taskActivity,
  unseenTaskIds,
  remoteControlStates = {},
  contextUsage = {},
  onReorderProjects,
  onReorderTasks,
  onReorderTasksCommit,
  rotationTasks = [],
  onReorderRotation,
  onRemoveFromRotation,
  onOpenSkillsBrowser,
  projectTokenStats = {},
}: LeftSidebarProps) {
  const showActiveTasksSection = useSettings((s) => s.showActiveTasksSection);
  // Project-reorder drag state for the collapsed rail. The expanded view owns
  // its own drag state inside ProjectsSection (the two views never coexist).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const isMac = window.electronAPI.getPlatform() === 'darwin';

  /* ── Collapsed ──────────────────────────────────────────── */

  if (collapsed) {
    const showRotation = showActiveTasksSection && rotationTasks.length > 0;

    return (
      <div className="sidebar-shell h-full flex flex-col items-center gap-1">
        {isMac && <div className="h-[28px] w-full flex-shrink-0 titlebar-drag" />}

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
                      <div className="status-dot-err absolute -right-1 top-1/2 -mt-[3px] w-2 h-2 rounded-full" />
                    ) : activity === 'waiting' ? (
                      <div className="status-dot-wait absolute -right-1 top-1/2 -mt-[3px] w-2 h-2 rounded-full" />
                    ) : activity === 'busy' ? (
                      <div className="absolute -right-1 top-1/2 -mt-[3px] w-2 h-2 rounded-full bg-amber-400 status-pulse" />
                    ) : activity === 'idle' && unseenTaskIds?.has(task.id) ? (
                      <div className="status-dot-unseen absolute -right-1 top-1/2 -mt-[3px] w-2 h-2 rounded-full" />
                    ) : activity === 'idle' ? (
                      <div className="status-dot-idle absolute -right-1 top-1/2 -mt-[3px] w-2 h-2 rounded-full" />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="glass-hairline w-6 my-1" />
          </>
        )}

        <Tooltip content="Create project">
          <button
            onClick={onOpenFolder}
            className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          >
            <Plus size={16} strokeWidth={1.8} />
          </button>
        </Tooltip>

        <div className="glass-hairline w-6 my-1" />

        <div
          className="flex-1 min-h-0 flex flex-col items-center gap-1 w-full"
          style={{
            overflow: 'clip',
            overflowClipMargin: '8px',
          }}
        >
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const activity = getProjectActivity(tasksByProject[project.id] || [], taskActivity);
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
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-medium transition-transform duration-200 ease-in-out titlebar-no-drag ${
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
                      className={`absolute -right-1 top-1/2 -mt-[3px] w-2 h-2 rounded-full ${
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

        <div className="glass-hairline w-6 my-1" />

        <Tooltip content="Skills">
          <button
            onClick={onOpenSkillsBrowser}
            className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          >
            <Blocks size={16} strokeWidth={1.5} />
          </button>
        </Tooltip>

        <Tooltip content="Settings">
          <button
            onClick={onOpenSettings}
            className="relative w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          >
            <Settings size={16} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <div className="h-3 flex-shrink-0" />
      </div>
    );
  }

  /* ── Expanded ───────────────────────────────────────────── */

  return (
    <div className="sidebar-shell h-full min-w-0 flex flex-col">
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

      {/* Project list — rows extend to the full sidebar width on the right
          (no reserved gutter). When content overflows, the scrollbar takes
          its slot at the right edge and rows shift to the same 8→W-8 range
          as the active-tasks rows; otherwise rows fill 8→W with no gap.
          The "Projects" header sits outside the scroll container so it stays
          pinned to the top while the list scrolls. */}
      <ProjectsSection
        projects={projects}
        activeProjectId={activeProjectId}
        tasksByProject={tasksByProject}
        activeTaskId={activeTaskId}
        taskActivity={taskActivity}
        unseenTaskIds={unseenTaskIds}
        remoteControlStates={remoteControlStates}
        contextUsage={contextUsage}
        projectTokenStats={projectTokenStats}
        onSelectProject={onSelectProject}
        onOpenFolder={onOpenFolder}
        onDeleteProject={onDeleteProject}
        onProjectSettings={onProjectSettings}
        onShowCommitGraph={onShowCommitGraph}
        onSelectTask={onSelectTask}
        onNewTask={onNewTask}
        onDeleteTask={onDeleteTask}
        onArchiveTask={onArchiveTask}
        onRestoreTask={onRestoreTask}
        onCloseTask={onCloseTask}
        onTaskSettings={onTaskSettings}
        onReorderProjects={onReorderProjects}
        onReorderTasks={onReorderTasks}
        onReorderTasksCommit={onReorderTasksCommit}
      />

      {/* Skills & Settings */}
      <div className="glass-hairline-t px-2 pt-4 pb-4 space-y-0.5">
        <button
          onClick={onOpenSkillsBrowser}
          className="flex items-center gap-2 px-2.5 py-[7px] w-full rounded-md text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-150 titlebar-no-drag"
        >
          <Blocks size={14} strokeWidth={1.8} />
          <span>Skills</span>
        </button>
        <button
          onClick={onOpenSettings}
          className="settings-btn flex items-center gap-2 px-2.5 py-[7px] w-full rounded-md text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-150 titlebar-no-drag"
        >
          <Settings size={14} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
