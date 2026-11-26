import { Plus, Search, Settings } from 'lucide-react';
import type { Project, Task } from '../../../shared/types';
import { IconButton } from '../ui/IconButton';
import { Segmented } from '../ui/Segmented';
import { StatusDot } from '../ui/StatusDot';
import { ProjectsSection } from './ProjectsSection';
import { TaskStateList } from './TaskStateList';
import { UpdateBanner } from './UpdateBanner';
import { useTaskStateList } from './useTaskStateList';
import { STATE_LABELS, liveRows, newTaskProjectId } from './taskStates';
import { useSettings } from '../../stores/settingsStore';
import { useUi } from '../../stores/uiStore';

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
  unseenTaskIds?: Set<string>;
  onReorderProjects?: (reordered: Project[]) => void;
  onReorderTasks?: (projectId: string, reordered: Task[]) => void;
  onReorderTasksCommit?: (projectId: string, reordered: Task[]) => void;
}

const isMac = window.electronAPI.getPlatform() === 'darwin';

/**
 * The app sidebar: a Tasks | Projects switch with find and create (a task
 * or a project, after the view) at its end, over the state-ordered task list
 * or the project tree, and settings at the foot.
 * Collapsed, it is a rail of state dots for the tasks with a live session.
 */
export function LeftSidebar(props: LeftSidebarProps) {
  const { projects, activeProjectId, tasksByProject, activeTaskId, collapsed } = props;
  const rows = useTaskStateList();
  const view = useSettings((s) => s.sidebarView);
  const setView = useSettings((s) => s.setSidebarView);
  const keybindings = useSettings((s) => s.keybindings);
  const setTaskFinderOpen = useUi((s) => s.setTaskFinderOpen);

  const settingsButton = (
    <IconButton title="Settings" shortcut={keybindings.openSettings} onClick={props.onOpenSettings}>
      <Settings size={14} strokeWidth={1.8} />
    </IconButton>
  );

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center bg-ground pb-3">
        <div className={isMac ? 'titlebar-drag h-11 w-full shrink-0' : 'h-2 w-full shrink-0'} />
        <div className="scrollbar-none flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
          {liveRows(rows).map(({ task, state }) => (
            <IconButton
              key={task.id}
              size="sm"
              title={`${task.name} · ${STATE_LABELS[state]}`}
              pressed={task.id === activeTaskId}
              onClick={() => props.onSelectTask(task.projectId, task.id)}
            >
              <StatusDot state={state} />
            </IconButton>
          ))}
        </div>
        {settingsButton}
      </div>
    );
  }

  const newTask = () => {
    const projectId = newTaskProjectId(
      activeProjectId,
      projects,
      Object.values(tasksByProject).flat(),
    );
    if (projectId) props.onNewTask(projectId);
    else props.onOpenFolder();
  };

  const projectsView = view === 'projects';

  return (
    <div className="flex h-full min-w-0 flex-col bg-ground">
      {/* On macOS the traffic lights sit in this strip; it drags the window. */}
      <div className={isMac ? 'titlebar-drag h-11 shrink-0' : 'h-2 shrink-0'} />
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-2">
        {/* The switch takes the room the actions leave, and fits itself to it. */}
        <div className="min-w-0 flex-1">
          <Segmented
            aria-label="Sidebar view"
            size="sm"
            fullWidth={false}
            value={view}
            onChange={setView}
            options={[
              { value: 'tasks', label: 'Tasks' },
              { value: 'projects', label: 'Projects' },
            ]}
          />
        </div>
        <IconButton
          size="sm"
          title="Find a task"
          shortcut={keybindings.findTask}
          onClick={() => setTaskFinderOpen(true)}
        >
          <Search size={14} strokeWidth={1.8} />
        </IconButton>
        {projectsView ? (
          <IconButton size="sm" title="Create project" onClick={props.onOpenFolder}>
            <Plus size={14} strokeWidth={1.8} />
          </IconButton>
        ) : (
          <IconButton size="sm" title="New task" shortcut={keybindings.newTask} onClick={newTask}>
            <Plus size={14} strokeWidth={1.8} />
          </IconButton>
        )}
      </div>

      {projectsView ? (
        <ProjectsSection
          projects={projects}
          activeProjectId={activeProjectId}
          tasksByProject={tasksByProject}
          activeTaskId={activeTaskId}
          unseenTaskIds={props.unseenTaskIds}
          onSelectProject={props.onSelectProject}
          onOpenFolder={props.onOpenFolder}
          onDeleteProject={props.onDeleteProject}
          onProjectSettings={props.onProjectSettings}
          onShowCommitGraph={props.onShowCommitGraph}
          onSelectTask={props.onSelectTask}
          onNewTask={props.onNewTask}
          onDeleteTask={props.onDeleteTask}
          onArchiveTask={props.onArchiveTask}
          onRestoreTask={props.onRestoreTask}
          onCloseTask={props.onCloseTask}
          onTaskSettings={props.onTaskSettings}
          onReorderProjects={props.onReorderProjects}
          onReorderTasks={props.onReorderTasks}
          onReorderTasksCommit={props.onReorderTasksCommit}
        />
      ) : (
        <TaskStateList
          rows={rows}
          projects={projects}
          activeTaskId={activeTaskId}
          onOpenFolder={props.onOpenFolder}
          onSelectTask={props.onSelectTask}
          onCloseTask={props.onCloseTask}
          onTaskSettings={props.onTaskSettings}
          onArchiveTask={props.onArchiveTask}
          onDeleteTask={props.onDeleteTask}
        />
      )}

      <UpdateBanner />
      <div className="flex shrink-0 items-center px-2 pt-1 pb-3">{settingsButton}</div>
    </div>
  );
}
