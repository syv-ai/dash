import type { CSSProperties, ReactNode } from 'react';
import { FolderOpen, PanelLeft } from 'lucide-react';
import { TerminalPane } from './terminal/TerminalPane';
import { ClaudeCliGate } from './terminal/ClaudeCliGate';
import { ProjectOverview } from './project/ProjectOverview';
import { TaskHeader } from './taskHeader/TaskHeader';
import { IconButton } from './ui/IconButton';
import { EmptyState } from './ui/EmptyState';
import { useRuntime } from '../stores/runtimeStore';
import { useSettings } from '../stores/settingsStore';
import { cn } from '../lib/cn';
import type { Project, Task } from '../../shared/types';

interface MainContentProps {
  activeTask: Task | null;
  activeProject: Project | null;
  tasks?: Task[];
  /** The terminal palette's background: the sheet takes it so the Claude
   *  terminal sits flush (the default palette's is the well). */
  terminalBg?: string;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onSelectTask: (id: string) => void;
  onEnableRemoteControl: () => void;
  /** The model the active task's session is running (live, from its status line). */
  modelName: string | null;
  onOpenIde: () => void;
  onNewTask: () => void;
  onProjectSettings: () => void;
  onShowCommitGraph: () => void;
  onDeleteProject: () => void;
  archivedTasks: Task[];
  onCloseTask: (id: string) => void;
  onTaskSettings: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onRestoreTask: (id: string) => void;
}

/**
 * The centre of the shell: a rounded sheet on the chrome, 8px clear of it,
 * holding the task's header and Claude terminal — or the project overview,
 * or the empty state.
 */
export function MainContent(props: MainContentProps) {
  const { activeTask, activeProject, terminalBg, sidebarCollapsed } = props;
  const claudeCli = useRuntime((s) => s.claudeCli);
  const toggleSidebarBinding = useSettings((s) => s.keybindings.toggleSidebar);

  // Without a task header the strip still drags the window and, with the
  // sidebar collapsed, offers to bring it back.
  const bareStrip = (
    <div className="titlebar-drag flex h-11 shrink-0 items-center px-2">
      {sidebarCollapsed && (
        <div className="titlebar-no-drag">
          <IconButton
            title="Show sidebar"
            shortcut={toggleSidebarBinding}
            onClick={props.onToggleSidebar}
          >
            <PanelLeft size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      )}
    </div>
  );

  let body: ReactNode;
  if (!activeProject) {
    body = (
      <>
        {bareStrip}
        <EmptyState
          icon={<FolderOpen size={14} strokeWidth={1.8} />}
          title="Open a folder to get started"
        />
      </>
    );
  } else if (!activeTask) {
    body = (
      <>
        {bareStrip}
        <div className="relative min-h-0 flex-1">
          <ProjectOverview
            project={activeProject}
            tasks={props.tasks ?? []}
            archivedTasks={props.archivedTasks}
            onSelectTask={props.onSelectTask}
            onNewTask={props.onNewTask}
            onProjectSettings={props.onProjectSettings}
            onShowCommitGraph={props.onShowCommitGraph}
            onDeleteProject={props.onDeleteProject}
            onCloseTask={props.onCloseTask}
            onTaskSettings={props.onTaskSettings}
            onDeleteTask={props.onDeleteTask}
            onArchiveTask={props.onArchiveTask}
            onRestoreTask={props.onRestoreTask}
          />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <TaskHeader
          task={activeTask}
          project={activeProject}
          modelName={props.modelName}
          sidebarCollapsed={sidebarCollapsed}
          inspectorCollapsed={props.inspectorCollapsed}
          onToggleSidebar={props.onToggleSidebar}
          onToggleInspector={props.onToggleInspector}
          onOpenIde={props.onOpenIde}
          onShowCommitGraph={props.onShowCommitGraph}
          onEnableRemoteControl={props.onEnableRemoteControl}
          onTaskSettings={() => props.onTaskSettings(activeTask.id)}
          onArchiveTask={() => props.onArchiveTask(activeTask.id)}
          onDeleteTask={() => props.onDeleteTask(activeTask.id)}
        />
        <div className="relative min-h-0 flex-1">
          {claudeCli && !claudeCli.supported ? (
            // Hard floor: never mount the terminal (and so never spawn) on a
            // missing or too-old CLI. `claudeCli === null` means the probe hasn't
            // answered yet; the terminal mounts and pty:startDirect awaits it.
            <ClaudeCliGate info={claudeCli} />
          ) : (
            <TerminalPane
              key={activeTask.id}
              id={activeTask.id}
              cwd={activeTask.path}
              permissionMode={activeTask.permissionMode}
              terminalBg={terminalBg}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="relative h-full bg-ground py-2 pr-2">
      {/* The gap above the sheet drags the window too. */}
      <div className="titlebar-drag absolute inset-x-0 top-0 h-2" />
      <div
        className={cn(
          'flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-line',
          terminalBg ? 'bg-(--sheet-bg)' : 'bg-well',
        )}
        style={{ '--sheet-bg': terminalBg } as CSSProperties}
      >
        {body}
      </div>
    </div>
  );
}
