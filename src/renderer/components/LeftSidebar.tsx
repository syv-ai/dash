import React, { useState } from 'react';
import {
  FolderOpen,
  Plus,
  Trash2,
  Archive,
  Settings,
  GitBranch,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { Project, Task } from '../../shared/types';
import { IconButton } from './ui/IconButton';

interface LeftSidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onOpenFolder: () => void;
  onDeleteProject: (id: string) => void;
  tasksByProject: Record<string, Task[]>;
  activeTaskId: string | null;
  onSelectTask: (projectId: string, taskId: string) => void;
  onNewTask: (projectId: string) => void;
  onDeleteTask: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  taskActivity: Record<string, 'busy' | 'idle'>;
}

export function LeftSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenFolder,
  onDeleteProject,
  tasksByProject,
  activeTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
  onArchiveTask,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  taskActivity,
}: LeftSidebarProps) {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  function toggleCollapse(projectId: string) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function projectActivity(projectId: string): 'busy' | 'idle' | null {
    const tasks = (tasksByProject[projectId] || []).filter((t) => !t.archivedAt);
    if (tasks.some((t) => taskActivity[t.id] === 'busy')) return 'busy';
    if (tasks.some((t) => taskActivity[t.id] === 'idle')) return 'idle';
    return null;
  }

  /* ── Collapsed ──────────────────────────────────────────── */

  if (collapsed) {
    return (
      <div
        className="h-full flex flex-col items-center py-3 gap-1"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          title="Expand sidebar"
        >
          <PanelLeftOpen size={18} strokeWidth={1.5} />
        </button>

        <button
          onClick={onOpenFolder}
          className="p-1.5 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          title="Add project"
        >
          <FolderOpen size={18} strokeWidth={1.5} />
        </button>

        <div className="w-6 border-t border-border/30 my-1" />

        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1 w-full px-1.5">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const activity = projectActivity(project.id);

            return (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={`relative w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-medium transition-all duration-150 titlebar-no-drag ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
                title={project.name}
              >
                {project.name.charAt(0).toUpperCase()}
                {activity && (
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-[hsl(var(--surface-1))] ${
                      activity === 'busy' ? 'bg-amber-400 status-pulse' : 'bg-emerald-400'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="w-6 border-t border-border/30 my-1" />

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag"
          title="Settings"
        >
          <Settings size={18} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  /* ── Expanded ───────────────────────────────────────────── */

  return (
    <div className="h-full flex flex-col" style={{ background: 'hsl(var(--surface-1))' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-sm font-medium text-muted-foreground/50 select-none">
          Projects
        </span>
        <div className="flex items-center gap-1">
          <IconButton onClick={onOpenFolder} title="Add project" className="titlebar-no-drag">
            <FolderOpen size={15} strokeWidth={1.8} />
          </IconButton>
          <IconButton onClick={onToggleCollapse} title="Collapse sidebar" className="titlebar-no-drag">
            <PanelLeftClose size={15} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-1">
        {projects.length === 0 && (
          <div className="px-2 py-10 text-center">
            <p className="text-[13px] text-muted-foreground/40 leading-relaxed">
              Open a folder to get started
            </p>
          </div>
        )}

        <div className="space-y-0.5">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isProjectCollapsed = collapsedProjects.has(project.id);
            const projectTasks = (tasksByProject[project.id] || []).filter(
              (t) => !t.archivedAt,
            );

            return (
              <div key={project.id}>
                {/* Project row */}
                <div
                  className={`group flex items-center gap-1.5 px-2 py-[7px] rounded-md text-sm cursor-pointer transition-all duration-150 ${
                    isActive
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    onSelectProject(project.id);
                    if (collapsedProjects.has(project.id)) {
                      toggleCollapse(project.id);
                    }
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(project.id);
                    }}
                    className="p-0.5 rounded flex-shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  >
                    {isProjectCollapsed ? (
                      <ChevronRight size={14} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={14} strokeWidth={2} />
                    )}
                  </button>

                  <span className="truncate flex-1">{project.name}</span>

                  {projectTasks.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/30 tabular-nums flex-shrink-0 mr-0.5">
                      {projectTasks.length}
                    </span>
                  )}

                  {/* New task — visible on active project, hover on others */}
                  <div
                    className={`transition-opacity duration-150 ${
                      isActive
                        ? 'opacity-50 hover:opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
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
                  </div>

                  {/* Delete — hover only */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
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
                    <div className="ml-6 mr-1 mt-0.5 space-y-px">
                      {projectTasks.map((task) => {
                        const activity = taskActivity[task.id];
                        const isActiveTask = task.id === activeTaskId;

                        return (
                          <div
                            key={task.id}
                            className={`group/task relative flex items-center gap-2 pl-3.5 pr-2 py-[6px] rounded-md text-[13px] cursor-pointer transition-all duration-150 ${
                              isActiveTask
                                ? 'bg-primary/10 text-foreground font-medium'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                            }`}
                            onClick={() => onSelectTask(project.id, task.id)}
                          >
                            {/* Status indicator */}
                            {activity === 'busy' ? (
                              <div className="w-[6px] h-[6px] rounded-full bg-amber-400 status-pulse flex-shrink-0" />
                            ) : activity === 'idle' ? (
                              <div className="w-[6px] h-[6px] rounded-full bg-emerald-400 flex-shrink-0" />
                            ) : null}

                            <span className="truncate flex-1">{task.name}</span>

                            {/* Right slot: branch icon by default, actions on hover */}
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {isActiveTask && (
                                <GitBranch
                                  size={11}
                                  className="text-muted-foreground group-hover/task:hidden"
                                  strokeWidth={2}
                                />
                              )}
                              <div className="hidden group-hover/task:flex gap-0.5">
                                <IconButton
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onArchiveTask(task.id);
                                  }}
                                  title="Archive task"
                                  size="sm"
                                >
                                  <Archive size={12} strokeWidth={1.8} />
                                </IconButton>
                                <IconButton
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteTask(task.id);
                                  }}
                                  title="Delete task"
                                  variant="destructive"
                                  size="sm"
                                >
                                  <Trash2 size={12} strokeWidth={1.8} />
                                </IconButton>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {projectTasks.length === 0 && isActive && (
                        <div className="px-2 py-3 text-center">
                          <p className="text-[10px] text-muted-foreground/40">No tasks yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings */}
      <div className="px-2 py-2 border-t border-border/30">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-2.5 py-[7px] w-full rounded-md text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-150 titlebar-no-drag"
        >
          <Settings size={14} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
