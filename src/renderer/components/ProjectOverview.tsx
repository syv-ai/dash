import React, { useState } from 'react';
import {
  GitBranch,
  Plus,
  FolderOpen,
  Settings,
  GitGraph,
  Trash2,
  Globe,
  GitFork,
  Code2,
  ChevronRight,
  ChevronDown,
  ArchiveRestore,
} from 'lucide-react';
import type { Project, Task, ActivityInfo } from '../../shared/types';
import { linkedItemUrl } from '../../shared/urls';
import { IconButton } from './ui/IconButton';
import { Tooltip } from './ui/Tooltip';

interface ProjectOverviewProps {
  project: Project;
  tasks: Task[];
  archivedTasks: Task[];
  taskActivity: Record<string, ActivityInfo>;
  onSelectTask: (id: string) => void;
  onNewTask: () => void;
  onProjectSettings: () => void;
  onShowCommitGraph: () => void;
  onDeleteProject: () => void;
  onDeleteTask: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onRestoreTask: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ActivityDot({ info }: { info?: ActivityInfo }) {
  const state = info?.state;
  if (state === 'error') {
    const label =
      info?.error?.type === 'rate_limit'
        ? 'Rate limited'
        : info?.error?.type === 'auth_error'
          ? 'Auth error'
          : 'Error';
    return (
      <Tooltip content={label}>
        <div className="w-2 h-2 rounded-full bg-destructive" />
      </Tooltip>
    );
  }
  if (state === 'waiting') {
    return (
      <Tooltip content="Waiting for user">
        <div className="w-2 h-2 rounded-full bg-orange-500" />
      </Tooltip>
    );
  }
  if (state === 'busy') {
    const label = info?.compacting
      ? 'Compacting context...'
      : info?.tool?.label || 'Claude is working';
    return (
      <Tooltip content={label}>
        <div className="w-2 h-2 rounded-full bg-amber-400 status-pulse" />
      </Tooltip>
    );
  }
  if (state === 'idle') {
    return (
      <Tooltip content="Idle">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
      </Tooltip>
    );
  }
  return <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />;
}

function remoteDisplayName(remote: string): string {
  return remote
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/^github\.com\//, '')
    .replace(/^dev\.azure\.com\//, '');
}

export function ProjectOverview({
  project,
  tasks,
  archivedTasks,
  taskActivity,
  onSelectTask,
  onNewTask,
  onProjectSettings,
  onShowCommitGraph,
  onDeleteProject,
  onDeleteTask,
  onArchiveTask,
  onRestoreTask,
}: ProjectOverviewProps) {
  const [showArchived, setShowArchived] = useState(false);
  const busyCount = tasks.filter((t) => taskActivity[t.id]?.state === 'busy').length;
  const waitingCount = tasks.filter((t) => taskActivity[t.id]?.state === 'waiting').length;
  const errorCount = tasks.filter((t) => taskActivity[t.id]?.state === 'error').length;
  const idleCount = tasks.filter((t) => taskActivity[t.id]?.state === 'idle').length;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Fixed header */}
      <div className="flex-shrink-0 border-b border-border/40 px-14 pt-8 pb-6">
        <div className="w-full">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-lg bg-accent/60 flex items-center justify-center flex-shrink-0">
                  <FolderOpen size={16} className="text-muted-foreground" strokeWidth={1.8} />
                </div>
                <h1 className="text-lg font-semibold text-foreground truncate">{project.name}</h1>
              </div>

              {/* Project metadata */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 ml-12 text-[11px] text-muted-foreground">
                {project.path && (
                  <Tooltip content={project.path}>
                    <span className="font-mono truncate max-w-[300px]">{project.path}</span>
                  </Tooltip>
                )}
                {project.gitRemote && (
                  <Tooltip content={project.gitRemote!}>
                    <a
                      href={project.gitRemote}
                      onClick={(e) => {
                        e.preventDefault();
                        window.electronAPI.openExternal(project.gitRemote!);
                      }}
                      className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                    >
                      <Globe size={11} strokeWidth={1.8} />
                      <span className="truncate max-w-[200px]">
                        {remoteDisplayName(project.gitRemote)}
                      </span>
                    </a>
                  </Tooltip>
                )}
                {project.baseRef && (
                  <span className="flex items-center gap-1">
                    <GitBranch size={11} strokeWidth={1.8} />
                    {project.baseRef}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0 ml-4">
              <IconButton onClick={onShowCommitGraph} title="Commit graph">
                <GitGraph size={15} strokeWidth={1.8} />
              </IconButton>
              <IconButton onClick={onProjectSettings} title="Project settings">
                <Settings size={15} strokeWidth={1.8} />
              </IconButton>
              <IconButton onClick={onDeleteProject} title="Delete project" variant="destructive">
                <Trash2 size={15} strokeWidth={1.8} />
              </IconButton>
              <div className="w-px h-5 bg-border/40 mx-1.5" />
              <button
                onClick={onNewTask}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-[12px] text-primary font-medium transition-colors"
              >
                <Plus size={14} strokeWidth={2} />
                <span>New task</span>
              </button>
            </div>
          </div>

          {/* Stats row */}
          {tasks.length > 0 && (
            <div className="flex items-center gap-4 mt-3 ml-12 text-[11px] text-muted-foreground">
              <span>
                {tasks.length} task{tasks.length === 1 ? '' : 's'}
              </span>
              {busyCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {busyCount} busy
                </span>
              )}
              {waitingCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  {waitingCount} waiting
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                  {errorCount} error
                </span>
              )}
              {idleCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {idleCount} idle
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-14 py-6">
        <div className="w-full">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-[13px] text-muted-foreground mb-4">
                No tasks yet — create one to start a Claude session.
              </p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/40 text-[11px] text-muted-foreground">
                <kbd className="px-1.5 py-0.5 rounded bg-accent text-[10px] font-mono font-medium">
                  Cmd
                </kbd>
                <span>+</span>
                <kbd className="px-1.5 py-0.5 rounded bg-accent text-[10px] font-mono font-medium">
                  N
                </kbd>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {tasks.map((task) => {
                const activity = taskActivity[task.id];
                const linkedItems = task.linkedItems ?? [];

                return (
                  <button
                    key={task.id}
                    onClick={() => onSelectTask(task.id)}
                    className="relative flex flex-col p-4 rounded-xl border border-border bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] hover:border-foreground/20 transition-all duration-150 text-left group overflow-hidden min-w-0"
                  >
                    {/* Open in IDE — top right */}
                    <Tooltip content="Open in IDE">
                      <div
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          const stored = localStorage.getItem('preferredIDE');
                          const ide = stored === 'cursor' || stored === 'code' ? stored : undefined;
                          window.electronAPI.openInIDE({
                            folderPath: task.path || project.path,
                            ide,
                          });
                        }}
                        className="absolute top-3 right-3 p-1 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60 opacity-0 group-hover:opacity-100"
                      >
                        <Code2 size={13} strokeWidth={1.8} />
                      </div>
                    </Tooltip>

                    {/* Task name + status */}
                    <div className="flex items-start gap-2.5 mb-3 pr-6 min-w-0">
                      <div className="mt-1.5 flex-shrink-0">
                        <ActivityDot info={activity} />
                      </div>
                      <span className="text-[13px] font-medium text-foreground flex-1 min-w-0 break-words">
                        {task.name}
                      </span>
                    </div>

                    {/* Details */}
                    <div className="flex flex-col gap-1.5 flex-1 text-[11px] w-full overflow-hidden">
                      {task.branch && (
                        <div className="text-muted-foreground truncate">
                          <span className="text-muted-foreground/70">Branch: </span>
                          {task.branch}
                        </div>
                      )}

                      {task.useWorktree && task.path && (
                        <div className="text-muted-foreground truncate">
                          <span className="text-muted-foreground/70">Worktree: </span>
                          <span className="font-mono text-[10px]">
                            {task.path.split(/[\\/]/).slice(-2).join('/')}
                          </span>
                        </div>
                      )}

                      {linkedItems.length > 0 &&
                        (() => {
                          const isAdo = linkedItems.some((i) => i.provider === 'ado');
                          const label = isAdo
                            ? linkedItems.length === 1
                              ? 'Work item:'
                              : 'Work items:'
                            : linkedItems.length === 1
                              ? 'Issue:'
                              : 'Issues:';
                          return (
                            <div className="flex items-start gap-1.5 text-muted-foreground">
                              <span className="flex-shrink-0 text-muted-foreground/70 mt-0.5">
                                {label}
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {linkedItems.slice(0, 3).map((item) => {
                                  const url = linkedItemUrl(item, project.gitRemote);
                                  const badge = (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-[10px] text-primary font-medium">
                                      #{item.id}
                                    </span>
                                  );
                                  const link = url ? (
                                    <a
                                      key={`${item.provider}-${item.id}`}
                                      href={url}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        window.electronAPI.openExternal(url);
                                      }}
                                      className="hover:opacity-80 transition-opacity"
                                    >
                                      {badge}
                                    </a>
                                  ) : (
                                    <span key={`${item.provider}-${item.id}`}>{badge}</span>
                                  );
                                  return item.title ? (
                                    <Tooltip
                                      content={item.title}
                                      key={`${item.provider}-${item.id}`}
                                    >
                                      {link}
                                    </Tooltip>
                                  ) : (
                                    link
                                  );
                                })}
                                {linkedItems.length > 3 && (
                                  <span className="text-[10px] text-muted-foreground self-center">
                                    +{linkedItems.length - 3} more
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                    </div>

                    {/* Delete — bottom right */}
                    <div
                      className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton
                        onClick={() => onDeleteTask(task.id)}
                        title="Delete task"
                        variant="destructive"
                        size="sm"
                      >
                        <Trash2 size={12} strokeWidth={1.8} />
                      </IconButton>
                    </div>

                    {/* Footer */}
                    <div className="mt-3 pt-2.5 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground">
                        Updated {timeAgo(task.updatedAt)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Archived tasks */}
          {archivedTasks.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowArchived((prev) => !prev)}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-3"
              >
                {showArchived ? (
                  <ChevronDown size={14} strokeWidth={2} />
                ) : (
                  <ChevronRight size={14} strokeWidth={2} />
                )}
                <span>Archived ({archivedTasks.length})</span>
              </button>

              {showArchived && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {archivedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-col p-4 rounded-xl border border-border/50 bg-[hsl(var(--surface-1))] text-left group"
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <span className="text-[13px] text-muted-foreground truncate flex-1">
                          {task.name}
                        </span>
                      </div>

                      {task.branch && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 mb-1.5">
                          <span className="flex-shrink-0 text-muted-foreground/50">Branch:</span>
                          <span className="truncate">{task.branch}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-2 pt-2.5 border-t border-border/30">
                        <span className="text-[10px] text-muted-foreground/70">
                          Archived {timeAgo(task.archivedAt!)}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <IconButton
                            onClick={() => onRestoreTask(task.id)}
                            title="Restore task"
                            size="sm"
                          >
                            <ArchiveRestore size={12} strokeWidth={1.8} />
                          </IconButton>
                          <IconButton
                            onClick={() => onDeleteTask(task.id)}
                            title="Delete task"
                            variant="destructive"
                            size="sm"
                          >
                            <Trash2 size={12} strokeWidth={1.8} />
                          </IconButton>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
