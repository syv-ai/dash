import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AdoConnectionForm } from './AdoConnectionForm';
import { isAdoRemote } from '../../shared/urls';
import type { Project } from '../../shared/types';
import { SettingsModalShell } from './ui/SettingsModalShell';
import { ConfigureForm } from './newProject/ConfigureForm';
import { configToValues, valuesToConfig, type ConfigureValues } from './newProject/types';

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
}

export function ProjectSettingsModal({ project, onClose, onRename }: ProjectSettingsModalProps) {
  const [value, setValue] = useState<ConfigureValues | null>(null);

  // Load the committed config once on open.
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.readWorkspaceConfig(project.path).then((resp) => {
      if (cancelled) return;
      const config = resp.success ? (resp.data ?? null) : null;
      setValue(
        configToValues(config, { name: project.name, baseRef: project.baseRef ?? 'origin/main' }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [project.path, project.name, project.baseRef]);

  async function persist(next: ConfigureValues) {
    if (next.name.trim() && next.name.trim() !== project.name) {
      onRename(project.id, next.name.trim());
    }
    const resp = await window.electronAPI.writeWorkspaceConfig({
      projectPath: project.path,
      config: valuesToConfig(next),
    });
    if (!resp.success) toast.error(resp.error || 'Failed to save project config');
    else toast.success('Project settings saved');
  }

  return (
    <SettingsModalShell title="Project Settings" onClose={onClose}>
      {value && (
        <>
          <ConfigureForm value={value} onChange={setValue} />
          <p className="text-[10px] text-muted-foreground/50 font-mono truncate">{project.path}</p>
          <div className="flex justify-end">
            <button
              onClick={() => void persist(value)}
              className="px-4 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all duration-150"
            >
              Save
            </button>
          </div>
          {isAdoRemote(project.gitRemote) && (
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                Azure DevOps
              </label>
              <AdoConnectionForm projectId={project.id} />
            </div>
          )}
        </>
      )}
    </SettingsModalShell>
  );
}
