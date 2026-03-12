import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AdoConnectionForm } from './AdoConnectionForm';
import { isAdoRemote } from '../../shared/urls';
import type { Project } from '../../shared/types';

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onWorktreeSetupScriptChange: (id: string, script: string | null) => void;
}

export function ProjectSettingsModal({
  project,
  onClose,
  onRename,
  onWorktreeSetupScriptChange,
}: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name);
  const [setupScript, setSetupScript] = useState(project.worktreeSetupScript ?? '');

  function handleSaveName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(project.id, trimmed);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[460px] max-h-[80vh] flex flex-col animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <h2 className="text-[14px] font-semibold text-foreground">Project Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Project name */}
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
              Project name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                }}
                className="flex-1 px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1.5 font-mono truncate">
              {project.path}
            </p>
          </div>

          {/* Worktree setup script */}
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
              Worktree setup script
            </label>
            <textarea
              value={setupScript}
              onChange={(e) => setSetupScript(e.target.value)}
              onBlur={() => onWorktreeSetupScriptChange(project.id, setupScript.trim() || null)}
              placeholder="e.g. pnpm install && cp .env.example .env"
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-1.5 leading-relaxed">
              Runs after a worktree is created. Env vars:{' '}
              <code className="font-mono">DASH_WORKTREE_PATH</code>,{' '}
              <code className="font-mono">DASH_PROJECT_PATH</code>,{' '}
              <code className="font-mono">DASH_BRANCH</code>
            </p>
          </div>

          {/* Azure DevOps connection — only for ADO projects */}
          {isAdoRemote(project.gitRemote) && (
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                Azure DevOps
              </label>
              <AdoConnectionForm projectId={project.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
