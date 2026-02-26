import React from 'react';
import { TerminalPane } from './TerminalPane';
import { Terminal, FolderOpen, GitBranch } from 'lucide-react';
import type { Project, Task } from '../../shared/types';

/** Convert a git remote URL (SSH or HTTPS) to a GitHub issues base URL */
function issueUrl(remote: string | null, num: number): string | null {
  if (!remote) return null;
  // git@github.com:org/repo.git → https://github.com/org/repo/issues/N
  const ssh = remote.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}/issues/${num}`;
  // https://github.com/org/repo.git → https://github.com/org/repo/issues/N
  const https = remote.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (https) return `https://github.com/${https[1]}/issues/${num}`;
  return null;
}

interface MainContentProps {
  activeTask: Task | null;
  activeProject: Project | null;
  sidebarCollapsed?: boolean;
  tasks?: Task[];
  activeTaskId?: string | null;
  taskActivity?: Record<string, 'busy' | 'idle' | 'waiting'>;
  onSelectTask?: (id: string) => void;
}

export function MainContent({
  activeTask,
  activeProject,
  sidebarCollapsed,
  tasks = [],
  activeTaskId,
  taskActivity = {},
  onSelectTask,
}: MainContentProps) {
  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-accent/60 flex items-center justify-center mx-auto mb-4">
            <FolderOpen size={22} className="text-muted-foreground/40" strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground/80 mb-1.5">Dash</h2>
          <p className="text-[13px] text-muted-foreground/60">Open a folder to get started</p>
        </div>
      </div>
    );
  }

  if (!activeTask) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-accent/60 flex items-center justify-center mx-auto mb-4">
            <Terminal size={22} className="text-muted-foreground/40" strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground/80 mb-1.5">
            {activeProject.name}
          </h2>
          <p className="text-[13px] text-muted-foreground/60 mb-3">
            Create a task to start a Claude session
          </p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/40 text-[11px] text-muted-foreground/50">
            <kbd className="px-1.5 py-0.5 rounded bg-accent text-[10px] font-mono font-medium">
              Cmd
            </kbd>
            <span>+</span>
            <kbd className="px-1.5 py-0.5 rounded bg-accent text-[10px] font-mono font-medium">
              N
            </kbd>
          </div>
        </div>
      </div>
    );
  }

  const taskHeader = (
    <div
      className="flex items-center gap-3 px-4 h-10 flex-shrink-0 border-b border-border/60"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {sidebarCollapsed && tasks.length > 0 ? (
        <>
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
            {tasks.map((task, i) => (
              <button
                key={task.id}
                onClick={() => onSelectTask?.(task.id)}
                className={`flex items-center gap-1.5 px-2.5 h-[28px] rounded text-xs whitespace-nowrap flex-shrink-0 transition-colors ${
                  task.id === activeTaskId
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    taskActivity[task.id] === 'waiting'
                      ? 'bg-orange-500'
                      : taskActivity[task.id] === 'busy'
                        ? 'bg-amber-400 animate-pulse'
                        : taskActivity[task.id] === 'idle'
                          ? 'bg-green-400'
                          : 'bg-muted-foreground/30'
                  }`}
                />
                <span className="truncate max-w-[140px]">{task.name}</span>
                {i < 9 && (
                  <div className="flex items-center gap-[2px] ml-1">
                    <kbd className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-[3px] text-[9px] font-medium leading-none border border-border/80 bg-gradient-to-b from-white/[0.06] to-transparent text-foreground/50 shadow-[0_0.5px_0_0.5px_hsl(var(--border)/0.4),inset_0_0.5px_0_hsl(var(--foreground)/0.04)] font-mono">
                      ⌘
                    </kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-[3px] text-[9px] font-medium leading-none border border-border/80 bg-gradient-to-b from-white/[0.06] to-transparent text-foreground/50 shadow-[0_0.5px_0_0.5px_hsl(var(--border)/0.4),inset_0_0.5px_0_hsl(var(--foreground)/0.04)] font-mono">
                      {i + 1}
                    </kbd>
                  </div>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-foreground/60 flex-shrink-0">
            <GitBranch size={11} strokeWidth={2} />
            <span className="text-[11px] font-mono">{activeTask.branch}</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="w-[7px] h-[7px] rounded-full bg-[hsl(var(--git-added))] status-pulse" />
            <span className="text-[13px] font-medium text-foreground">{activeTask.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-foreground/60">
            <GitBranch size={11} strokeWidth={2} />
            <span className="text-[11px] font-mono">{activeTask.branch}</span>
          </div>
          {activeTask.linkedIssues && activeTask.linkedIssues.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              {activeTask.linkedIssues.map((num) => {
                const url = issueUrl(activeProject?.gitRemote ?? null, num);
                return url ? (
                  <a
                    key={num}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                  >
                    #{num}
                  </a>
                ) : (
                  <span
                    key={num}
                    className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
                  >
                    #{num}
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {taskHeader}
      <div className="flex-1 min-h-0">
        <TerminalPane
          key={activeTask.id}
          id={activeTask.id}
          cwd={activeTask.path}
          autoApprove={activeTask.autoApprove}
        />
      </div>
    </div>
  );
}
