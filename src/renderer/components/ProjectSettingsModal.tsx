import React, { useState } from 'react';
import { AdoConnectionForm } from './AdoConnectionForm';
import { isAdoRemote } from '../../shared/urls';
import type { Project } from '../../shared/types';
import { SettingsModalShell } from './ui/SettingsModalShell';

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
}

export function ProjectSettingsModal({ project, onClose, onRename }: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name);

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
          Workspace setup
        </label>
        <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
          Automate per-worktree setup and teardown by committing{' '}
          <code className="font-mono text-[11px] text-foreground/90">.dash/config.json</code> to
          this project:
        </p>
        <pre className="mt-2 p-3 rounded-lg bg-surface-1 border border-input/40 text-[11px] font-mono text-foreground/85 overflow-x-auto leading-relaxed">{`{
  "setup":    ["pnpm install", "cp ../.env .env"],
  "teardown": ["docker compose down"]
}`}</pre>
        <p className="text-[11px] text-muted-foreground/60 mt-2 leading-relaxed">
          <code className="font-mono">setup</code> runs in each new worktree;{' '}
          <code className="font-mono">teardown</code> runs before a worktree is removed. Commands
          join with <code className="font-mono">&amp;&amp;</code> so failures short-circuit.
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-2 leading-relaxed">
          Env vars exposed to scripts:{' '}
          <code className="font-mono text-foreground/80">DASH_WORKTREE_PATH</code>,{' '}
          <code className="font-mono text-foreground/80">DASH_PROJECT_PATH</code>,{' '}
          <code className="font-mono text-foreground/80">DASH_BRANCH</code>.
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-2 leading-relaxed">
          Per-developer overrides go in <code className="font-mono">.dash/config.local.json</code>{' '}
          (gitignore it). Shell-script fallbacks: <code className="font-mono">.dash/setup.sh</code>{' '}
          and <code className="font-mono">.dash/teardown.sh</code> in the project root.
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
