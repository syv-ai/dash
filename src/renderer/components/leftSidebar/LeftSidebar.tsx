import { FolderTree, Plus, Search, Settings } from 'lucide-react';
import type { Project, Task } from '../../../shared/types';
import { IconButton } from '../ui/IconButton';
import { StatusDot } from '../ui/StatusDot';
import { ProjectsSection } from './ProjectsSection';
import { TaskStateList } from './TaskStateList';
import { UpdateBanner } from './UpdateBanner';
import { useTaskStateList } from './useTaskStateList';
import { STATE_LABELS, newTaskProjectId } from './taskStates';
import { useSettings } from '../../stores/settingsStore';
import { useUi } from '../../stores/uiStore';
import { formatBinding, type KeyBinding } from '../../keybindings';

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

/** A tooltip label with its shortcut, e.g. "Find a task  ⌘K". */
function withShortcut(label: string, binding: KeyBinding | undefined): string {
  return binding ? `${label}  ${formatBinding(binding)}` : label;
}

/**
 * The app sidebar: a title bar (find, new task, tasks/projects toggle), the
 * state-ordered task list or the project tree, and settings at the foot.
 * Collapsed, it is a rail of state dots for the tasks that aren't idle.
 */
export function LeftSidebar(props: LeftSidebarProps) {
  const { projects, activeProjectId, tasksByProject, activeTaskId, collapsed } = props;
  const rows = useTaskStateList();
  const view = useSettings((s) => s.sidebarView);
  const setView = useSettings((s) => s.setSidebarView);
  const keybindings = useSettings((s) => s.keybindings);
  const setTaskFinderOpen = useUi((s) => s.setTaskFinderOpen);

  const settingsButton = (
    <IconButton
      title={withShortcut('Settings', keybindings.openSettings)}
      onClick={props.onOpenSettings}
    >
      <Settings size={14} strokeWidth={1.8} />
    </IconButton>
  );

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center bg-ground pb-3">
        <div className={isMac ? 'titlebar-drag h-11 w-full shrink-0' : 'h-2 w-full shrink-0'} />
        <div className="scrollbar-none flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
          {rows.active.map(({ task, state }) => (
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
  const showingProjects = view === 'projects';

  return (
    <div className="flex h-full min-w-0 flex-col bg-ground">
      {/* Title bar: on macOS the traffic lights sit at its left; the strip
          drags the window, its buttons don't. */}
      <div className="titlebar-drag flex h-11 shrink-0 items-center justify-end gap-0.5 px-2">
        <div className="titlebar-no-drag flex items-center gap-0.5">
          <IconButton
            title={withShortcut('Find a task', keybindings.findTask)}
            onClick={() => setTaskFinderOpen(true)}
          >
            <Search size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton title={withShortcut('New task', keybindings.newTask)} onClick={newTask}>
            <Plus size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton
            title={showingProjects ? 'Tasks' : 'Projects'}
            pressed={showingProjects}
            onClick={() => setView(showingProjects ? 'tasks' : 'projects')}
          >
            <FolderTree size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>

      {showingProjects ? (
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
