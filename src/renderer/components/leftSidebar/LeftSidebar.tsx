import { useEffect, useState } from 'react';
import { Plus, Search, Settings } from 'lucide-react';
import type { ContextUsage, Project, Task } from '../../../shared/types';
import { ClaudeUpdateButton } from '../claudeUpdate/ClaudeUpdateButton';
import { SystemHealthButton } from '../systemHealth/SystemHealthButton';
import { IconButton } from '../ui/IconButton';
import { ViewPanel, ViewTabs } from '../ui/ViewTabs';
import { ProjectsSection } from './ProjectsSection';
import { SessionRail } from './SessionRail';
import { TaskStateList } from './TaskStateList';
import { UpdateBanner } from './UpdateBanner';
import { useTaskStateList } from './useTaskStateList';
import { liveRows } from './taskStates';
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
   *  tabs' labels in full and create and find beside them. Narrower, the
   *  sidebar goes to its rail (T16). */
  onMinWidth?: (px: number) => void;
}

/** The view row's room besides the tabs: its 8px gutters, the three 2px gaps
 *  (tabs, spacer, create, find) and create and find (24px each; create shows
 *  in the Projects view only, but the room holds in both, so the least width
 *  doesn't change with the view). */
const VIEW_ROW_REST_PX = 16 + 6 + 48;

/** The sidebar's least width (px) whatever its view row needs: room for a
 *  task's name, marks and context percent before it snaps to the rail (T28). */
export const LEFT_SIDEBAR_MIN_PX = 240;

const isMac = window.electronAPI.getPlatform() === 'darwin';

/**
 * The app sidebar: Projects | Tasks view tabs (`ViewTabs`' pills; counting
 * projects and live sessions) with, in the Projects view, create a project
 * (a task is made under its project) and find at the row's end, over the
 * project tree or the state-ordered task list, and settings at the foot, with
 * the health icon (Settings → System health) and the Claude Code update icon
 * beside it (above it on the rail).
 * Collapsed, it is a rail of the tasks with a live session (`SessionRail`).
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
        <SessionRail
          rows={liveRows(rows)}
          activeTaskId={activeTaskId}
          contextUsage={props.contextUsage}
          onSelectTask={props.onSelectTask}
        />
        <ClaudeUpdateButton />
        <SystemHealthButton rail onSelectTask={props.onSelectTask} />
        {settingsButton}
      </div>
    );
  }

  const projectsView = view === 'projects';
  // One list feeds both the tabs and the panel's slide order, so they can't drift.
  const viewOptions = [
    {
      value: 'projects' as const,
      label: 'Projects',
      count: projects.length,
      countLabel: 'Projects',
    },
    {
      value: 'tasks' as const,
      label: 'Tasks',
      count: liveRows(rows).length,
      countLabel: 'Live sessions',
    },
  ];

  return (
    <div className="flex h-full min-w-0 flex-col bg-ground">
      {/* On macOS the traffic lights sit in this strip; it drags the window. */}
      <div className={isMac ? 'titlebar-drag h-11 shrink-0' : 'h-2 shrink-0'} />
      {/* The view tabs, then create and find at the row's end. */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-2">
        <ViewTabs
          variant="pill"
          aria-label="Sidebar view"
          value={view}
          onChange={setView}
          onMinWidth={setTabsMinPx}
          options={viewOptions}
        />
        <div className="min-w-0 flex-1" />
        {/* Tasks are made under their project, so only the Projects view
            creates (a project); the Tasks view keeps its slot empty, so the
            row (the tabs' fit, find) is the same in both views. Create sits
            before find, so find holds the row's end in both. */}
        {projectsView ? (
          <IconButton size="sm" title="Create project" onClick={props.onOpenFolder}>
            <Plus size={14} strokeWidth={1.8} />
          </IconButton>
        ) : (
          <div aria-hidden className="size-6 shrink-0" />
        )}
        <IconButton
          size="sm"
          title="Find a task"
          shortcut={keybindings.findTask}
          onClick={() => setTaskFinderOpen(true)}
        >
          <Search size={14} strokeWidth={1.8} />
        </IconButton>
      </div>

      <ViewPanel
        value={view}
        order={viewOptions.map((o) => o.value)}
        onChange={setView}
        className="flex min-h-0 flex-1 flex-col"
      >
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
      </ViewPanel>

      <UpdateBanner />
      <div className="flex shrink-0 items-center gap-0.5 px-2 pt-1 pb-3">
        {settingsButton}
        <SystemHealthButton onSelectTask={props.onSelectTask} />
        <ClaudeUpdateButton />
      </div>
    </div>
  );
}
