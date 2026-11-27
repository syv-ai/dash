import { useEffect, useState } from 'react';
import { Plus, Search, Settings } from 'lucide-react';
import type { ContextUsage, Project, Task } from '../../../shared/types';
import { ClaudeUpdateButton } from '../claudeUpdate/ClaudeUpdateButton';
import { IconButton } from '../ui/IconButton';
import { ViewTabs } from '../ui/ViewTabs';
import { StatusDot } from '../ui/StatusDot';
import { ProjectsSection } from './ProjectsSection';
import { TaskStateList } from './TaskStateList';
import { UpdateBanner } from './UpdateBanner';
import { useTaskStateList } from './useTaskStateList';
import { STATE_LABELS, liveRows } from './taskStates';
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
  /** Each live task's session context, from the statusLine (`useStatusLine`). */
  contextUsage?: Record<string, ContextUsage>;
  /** The sidebar's least width (px), once its tabs are measured: the view
   *  tabs' labels in full and find and create beside them. Narrower, the
   *  sidebar goes to its rail (T16). */
  onMinWidth?: (px: number) => void;
}

/** The view row's room besides the tabs: its 8px gutters, the three 2px gaps
 *  (tabs, spacer, find, create) and find and create (24px each; create shows
 *  in the Projects view only, but the room holds in both, so the least width
 *  doesn't change with the view). */
const VIEW_ROW_REST_PX = 16 + 6 + 48;

/** The sidebar's least width (px) whatever its view row needs: room for a
 *  task's name, marks and context percent before it snaps to the rail (T28). */
const LEFT_SIDEBAR_MIN_PX = 240;

const isMac = window.electronAPI.getPlatform() === 'darwin';

/**
 * The app sidebar: Projects | Tasks view tabs (`ViewTabs`' pills; counting
 * projects and live sessions) with find and, in the Projects view, create a
 * project at the row's end (a task is made under its project), over the
 * project tree or the state-ordered task list, and settings (with the Claude Code update icon) at the foot.
 * Collapsed, it is a rail of state dots for the tasks with a live session.
 */
export function LeftSidebar(props: LeftSidebarProps) {
  const { projects, activeProjectId, tasksByProject, activeTaskId, collapsed } = props;
  const rows = useTaskStateList();
  const view = useSettings((s) => s.sidebarView);
  const setView = useSettings((s) => s.setSidebarView);
  const keybindings = useSettings((s) => s.keybindings);
  const setTaskFinderOpen = useUi((s) => s.setTaskFinderOpen);
  const [tabsMinPx, setTabsMinPx] = useState<number>();
  const { onMinWidth } = props;
  useEffect(() => {
    if (tabsMinPx !== undefined) {
      onMinWidth?.(Math.max(LEFT_SIDEBAR_MIN_PX, tabsMinPx + VIEW_ROW_REST_PX));
    }
  }, [tabsMinPx, onMinWidth]);

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
        <ClaudeUpdateButton />
        {settingsButton}
      </div>
    );
  }

  const projectsView = view === 'projects';

  return (
    <div className="flex h-full min-w-0 flex-col bg-ground">
      {/* On macOS the traffic lights sit in this strip; it drags the window. */}
      <div className={isMac ? 'titlebar-drag h-11 shrink-0' : 'h-2 shrink-0'} />
      {/* The view tabs, then find and create at the row's end. */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-2">
        <ViewTabs
          variant="pill"
          aria-label="Sidebar view"
          value={view}
          onChange={setView}
          onMinWidth={setTabsMinPx}
          options={[
            {
              value: 'projects',
              label: 'Projects',
              count: projects.length,
              countLabel: 'Projects',
            },
            {
              value: 'tasks',
              label: 'Tasks',
              count: liveRows(rows).length,
              countLabel: 'Live sessions',
            },
          ]}
        />
        <div className="min-w-0 flex-1" />
        <IconButton
          size="sm"
          title="Find a task"
          shortcut={keybindings.findTask}
          onClick={() => setTaskFinderOpen(true)}
        >
          <Search size={14} strokeWidth={1.8} />
        </IconButton>
        {/* Tasks are made under their project, so only the Projects view
            creates (a project). */}
        {projectsView && (
          <IconButton size="sm" title="Create project" onClick={props.onOpenFolder}>
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
          contextUsage={props.contextUsage}
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
          contextUsage={props.contextUsage}
          onOpenFolder={props.onOpenFolder}
          onSelectTask={props.onSelectTask}
          onCloseTask={props.onCloseTask}
          onTaskSettings={props.onTaskSettings}
          onArchiveTask={props.onArchiveTask}
          onDeleteTask={props.onDeleteTask}
        />
      )}

      <UpdateBanner />
      <div className="flex shrink-0 items-center gap-0.5 px-2 pt-1 pb-3">
        {settingsButton}
        <ClaudeUpdateButton />
      </div>
    </div>
  );
}
