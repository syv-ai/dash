import React, { useState } from 'react';
import { FolderOpen, Plus, Trash2, Archive, Settings, GitBranch, ChevronRight, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Project, Task } from '../../shared/types';

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

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center" style={{ background: 'hsl(var(--surface-1))' }}>
        {/* Expand button */}
        <div className="pt-3 pb-1">
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-all duration-150 titlebar-no-drag"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={14} strokeWidth={1.8} />
          </button>
        </div>

        {/* Open folder */}
        <div className="pb-1">
          <button
            onClick={onOpenFolder}
            className="p-1.5 rounded-md hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-all duration-150 titlebar-no-drag"
            title="Open folder"
          >
            <FolderOpen size={14} strokeWidth={1.8} />
          </button>
        </div>

        {/* Divider */}
        <div className="w-5 border-t border-border/40 my-1" />

        {/* Project avatars */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1 py-1 w-full px-1.5">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold transition-all duration-150 titlebar-no-drag ${
                  isActive
                    ? 'bg-primary/20 text-primary'
                    : 'bg-accent/60 text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
                title={project.name}
              >
                {project.name.charAt(0).toUpperCase()}
              </button>
            );
          })}
        </div>

        {/* Settings */}
        <div className="py-2 border-t border-border/40 w-full flex justify-center">
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-md hover:bg-accent/80 text-muted-foreground/70 hover:text-foreground transition-all duration-150 titlebar-no-drag"
            title="Settings"
          >
            <Settings size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'hsl(var(--surface-1))' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground/70 tracking-[0.08em]">
          Projects
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onOpenFolder}
            className="p-1 rounded-md hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-all duration-150 titlebar-no-drag"
            title="Open folder"
          >
            <FolderOpen size={13} strokeWidth={1.8} />
          </button>
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-md hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-all duration-150 titlebar-no-drag"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Project list with nested tasks */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {projects.length === 0 && (
          <div className="px-2 py-8 text-center">
            <div className="w-8 h-8 rounded-xl bg-accent/60 flex items-center justify-center mx-auto mb-2">
              <FolderOpen size={14} className="text-muted-foreground/50" />
            </div>
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
              Open a folder to get started
            </p>
          </div>
        )}

        <div className="space-y-1">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isCollapsed = collapsedProjects.has(project.id);
            const projectTasks = (tasksByProject[project.id] || []).filter((t) => !t.archivedAt);

            return (
              <div key={project.id}>
                {/* Project row */}
                <div
                  className={`group flex items-center gap-1.5 px-2 py-[7px] rounded-lg text-[13px] cursor-pointer transition-all duration-150 ${
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  }`}
                  onClick={() => {
                    onSelectProject(project.id);
                    // Auto-expand when selecting
                    if (collapsedProjects.has(project.id)) {
                      toggleCollapse(project.id);
                    }
                  }}
                >
                  {/* Collapse toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(project.id);
                    }}
                    className="p-0.5 rounded hover:bg-accent/60 flex-shrink-0 transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={12} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={12} strokeWidth={2} />
                    )}
                  </button>

                  {/* Project avatar */}
                  <div className={`w-[18px] h-[18px] rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    isActive
                      ? 'bg-primary/20 text-primary'
                      : 'bg-accent/80 text-muted-foreground'
                  }`}>
                    {project.name.charAt(0).toUpperCase()}
                  </div>

                  <span className="truncate flex-1">{project.name}</span>

                  {/* Task count */}
                  {projectTasks.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/30 tabular-nums flex-shrink-0">
                      {projectTasks.length}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-all duration-150">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewTask(project.id);
                      }}
                      className="p-0.5 rounded-md hover:bg-accent text-muted-foreground/50 hover:text-foreground"
                      title="New task"
                    >
                      <Plus size={11} strokeWidth={2} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(project.id);
                      }}
                      className="p-0.5 rounded-md hover:bg-destructive/15 text-muted-foreground/50 hover:text-destructive"
                      title="Delete project"
                    >
                      <Trash2 size={11} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>

                {/* Tasks nested under project */}
                {!isCollapsed && (
                  <div className="ml-[18px] pl-2 border-l border-border/30">
                    {projectTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`group flex items-center gap-2 px-2 py-[6px] rounded-lg text-[12px] cursor-pointer transition-all duration-150 relative ${
                          task.id === activeTaskId
                            ? 'bg-primary/10 text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                        }`}
                        onClick={() => onSelectTask(project.id, task.id)}
                      >
                        {/* Active indicator bar */}
                        {task.id === activeTaskId && (
                          <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-[3px] h-3.5 rounded-r-full bg-primary" />
                        )}

                        {/* Status dot */}
                        <div className="relative flex-shrink-0">
                          <div
                            className={`w-[6px] h-[6px] rounded-full ${
                              task.status === 'active'
                                ? 'bg-[hsl(var(--git-added))] status-pulse'
                                : task.id === activeTaskId
                                  ? 'bg-primary/60'
                                  : 'bg-muted-foreground/25'
                            }`}
                          />
                        </div>

                        <span className="truncate flex-1">{task.name}</span>

                        {/* Branch indicator */}
                        {task.id === activeTaskId && (
                          <GitBranch size={9} className="text-muted-foreground/40 flex-shrink-0" strokeWidth={2} />
                        )}

                        {/* Hover actions */}
                        <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-all duration-150">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchiveTask(task.id);
                            }}
                            className="p-0.5 rounded-md hover:bg-accent text-muted-foreground/50 hover:text-muted-foreground"
                            title="Archive task"
                          >
                            <Archive size={10} strokeWidth={1.8} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTask(task.id);
                            }}
                            className="p-0.5 rounded-md hover:bg-destructive/15 text-muted-foreground/50 hover:text-destructive"
                            title="Delete task"
                          >
                            <Trash2 size={10} strokeWidth={1.8} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {projectTasks.length === 0 && isActive && (
                      <div className="px-2 py-3 text-center">
                        <p className="text-[10px] text-muted-foreground/40">
                          No tasks yet
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings */}
      <div className="px-3 py-2 border-t border-border/40">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-2.5 py-[7px] w-full rounded-lg text-[13px] text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground transition-all duration-150 titlebar-no-drag"
        >
          <Settings size={13} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
