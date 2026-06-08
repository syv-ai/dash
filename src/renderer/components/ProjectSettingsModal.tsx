import React, { useState } from 'react';
import { AdoConnectionForm } from './AdoConnectionForm';
import { isAdoRemote } from '../../shared/urls';
import type { Project } from '../../shared/types';
import { SettingsModalShell } from './ui/SettingsModalShell';

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
    <SettingsModalShell title="Project Settings" onClose={onClose}>
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
            className="flex-1 px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
          />
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 font-mono truncate">
          {project.path}
        </p>
      </div>

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
          className="w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
        />
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 leading-relaxed">
          Runs after a worktree is created. Env vars:{' '}
          <code className="font-mono">DASH_WORKTREE_PATH</code>,{' '}
          <code className="font-mono">DASH_PROJECT_PATH</code>,{' '}
          <code className="font-mono">DASH_BRANCH</code>
        </p>
      </div>

      {isAdoRemote(project.gitRemote) && (
        <div>
          <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
            Azure DevOps
          </label>
          <AdoConnectionForm projectId={project.id} />
        </div>
      )}
    </SettingsModalShell>
  );
}
