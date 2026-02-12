import React from 'react';
import { TerminalPane } from './TerminalPane';
import { Terminal, FolderOpen, GitBranch } from 'lucide-react';
import type { Project, Task } from '../../shared/types';

interface MainContentProps {
  activeTask: Task | null;
  activeProject: Project | null;
  terminalEmulator?: 'builtin' | 'external';
  externalTerminalApp?: string;
}

export function MainContent({
  activeTask,
  activeProject,
  terminalEmulator,
  externalTerminalApp,
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

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Task header bar */}
      <div
        className="flex items-center gap-3 px-4 h-10 flex-shrink-0 border-b border-border/60"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-[7px] h-[7px] rounded-full bg-[hsl(var(--git-added))] status-pulse" />
          <span className="text-[13px] font-medium text-foreground">{activeTask.name}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground/50">
          <GitBranch size={11} strokeWidth={2} />
          <span className="text-[11px] font-mono">{activeTask.branch}</span>
        </div>
      </div>

      {/* Terminal area */}
      <div className="flex-1 min-h-0">
        <TerminalPane
          key={`${activeTask.id}-${terminalEmulator}`}
          id={activeTask.id}
          cwd={activeTask.path}
          autoApprove={activeTask.autoApprove}
          terminalEmulator={terminalEmulator}
          externalTerminalApp={externalTerminalApp}
        />
      </div>
    </div>
  );
}
