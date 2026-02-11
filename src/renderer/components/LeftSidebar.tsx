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
      <div className="h-full flex flex-col items-center py-3" style={{ background: 'hsl(var(--surface-1))' }}>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-accent/60 text-muted-foreground/60 hover:text-foreground transition-colors titlebar-no-drag"
          title="Expand sidebar"
        >
          <PanelLeftOpen size={18} strokeWidth={1.5} />
        </button>

        <button
          onClick={onOpenFolder}
          className="mt-1 p-1.5 rounded-md hover:bg-accent/60 text-muted-foreground/60 hover:text-foreground transition-colors titlebar-no-drag"
          title="Open folder"
        >
          <FolderOpen size={18} strokeWidth={1.5} />
        </button>

        <div className="w-6 border-t border-border/30 my-2" />

        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1.5 w-full px-1.5">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-medium transition-colors titlebar-no-drag ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground/50 hover:bg-accent/60 hover:text-foreground'
                }`}
                title={project.name}
              >
                {project.name.charAt(0).toUpperCase()}
              </button>
            );
          })}
        </div>

        <div className="w-6 border-t border-border/30 my-2" />

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-md hover:bg-accent/60 text-muted-foreground/40 hover:text-foreground transition-colors titlebar-no-drag"
          title="Settings"
        >
          <Settings size={18} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'hsl(var(--surface-1))' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[13px] font-medium text-muted-foreground/50 select-none">
          Projects
        </span>
        <div className="flex items-center gap-1">
          <IconButton onClick={onOpenFolder} title="Open folder" className="titlebar-no-drag">
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

        <div className="space-y-px">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isCollapsed = collapsedProjects.has(project.id);
            const projectTasks = (tasksByProject[project.id] || []).filter((t) => !t.archivedAt);

            return (
              <div key={project.id}>
                {/* Project row */}
                <div
                  className={`group flex items-center gap-1.5 px-2 py-[7px] rounded-full text-[13px] cursor-pointer transition-all duration-150 ${
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
                    {isCollapsed ? (
                      <ChevronRight size={14} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={14} strokeWidth={2} />
                    )}
                  </button>

                  {/* Project avatar */}
                  <div
                    className={`w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                      isActive ? 'bg-primary/20 text-primary' : 'bg-accent/80 text-muted-foreground'
                    }`}
                  >
                    {project.name.charAt(0).toUpperCase()}
                  </div>

                  <span className="truncate flex-1">{project.name}</span>

                  {projectTasks.length > 0 && (
                    <span className="text-[10px] text-foreground/40 tabular-nums flex-shrink-0">
                      {projectTasks.length}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-all duration-150">
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
                  style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="mt-1 ml-[18px]">
                      {projectTasks.map((task, idx) => {
                        const isLast = idx === projectTasks.length - 1;
                        return (
                          <div key={task.id} className="flex">
                            {/* Tree connector */}
                            <div className="flex-shrink-0 w-4 relative">
                              {/* Vertical line */}
                              {!isLast && (
                                <div className="absolute left-[5px] top-0 bottom-0 w-px bg-border/40" />
                              )}
                              {/* Branch arm: vertical to center + horizontal */}
                              <div className="absolute left-[5px] top-0 h-1/2 w-px bg-border/40" />
                              <div className="absolute left-[5px] top-1/2 w-[10px] h-px bg-border/40" />
                            </div>

                            {/* Task card */}
                            <div
                              className={`group flex-1 flex items-center gap-2 px-2 py-[6px] rounded-full text-[12px] cursor-pointer transition-all duration-150 ${
                                task.id === activeTaskId
                                  ? 'bg-primary/15 text-foreground font-medium'
                                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                              }`}
                              onClick={() => onSelectTask(project.id, task.id)}
                            >
                              {/* Status dot */}
                              <div className="relative flex-shrink-0">
                                <div
                                  className={`w-[6px] h-[6px] rounded-full ${
                                    task.status === 'active'
                                      ? 'bg-[hsl(var(--git-added))] status-pulse'
                                      : 'bg-muted-foreground/25'
                                  }`}
                                />
                              </div>

                              <span className="truncate flex-1">{task.name}</span>

                              {/* Branch indicator */}
                              {task.id === activeTaskId && (
                                <GitBranch
                                  size={11}
                                  className="text-foreground/50 flex-shrink-0"
                                  strokeWidth={2}
                                />
                              )}

                              {/* Hover actions */}
                              <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-all duration-150">
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
          className="flex items-center gap-2 px-2.5 py-[7px] w-full rounded-lg text-[13px] text-foreground/70 hover:bg-accent/60 hover:text-foreground transition-all duration-150 titlebar-no-drag"
        >
          <Settings size={14} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
