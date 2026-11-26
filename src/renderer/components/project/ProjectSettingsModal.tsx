import React, { useEffect, useState } from 'react';
import { toast } from '../ui/toast';
import { AdoConnectionForm } from '../vcs/ado/AdoConnectionForm';
import { isAdoRemote } from '../../../shared/urls';
import type { Project } from '../../../shared/types';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { FormSection } from '../ui/Field';
import { useModalClose } from '../ui/Modal';
import { ConfigureForm } from '../newProject/ConfigureForm';
import { configToValues, valuesToConfig, type ConfigureValues } from '../newProject/types';

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
}

export function ProjectSettingsModal({ project, onClose, onRename }: ProjectSettingsModalProps) {
  return (
    <Dialog size="lg" onClose={onClose}>
      <ProjectSettingsBody project={project} onRename={onRename} />
    </Dialog>
  );
}

function ProjectSettingsBody({ project, onRename }: Omit<ProjectSettingsModalProps, 'onClose'>) {
  const close = useModalClose();
  const [value, setValue] = useState<ConfigureValues | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the committed config once on open. Shared only: saving writes config.json,
  // so config.local.json overrides must not be read in.
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.readWorkspaceConfig(project.path, { shared: true }).then((resp) => {
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

  async function save(next: ConfigureValues) {
    setSaving(true);
    try {
      if (next.name.trim() && next.name.trim() !== project.name) {
        onRename(project.id, next.name.trim());
      }
      const resp = await window.electronAPI.writeWorkspaceConfig({
        projectPath: project.path,
        config: valuesToConfig(next),
      });
      if (!resp.success) {
        toast.error(resp.error || 'Failed to save project config');
        return;
      }
      toast.success('Project settings saved');
      close();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader title="Project settings" description={project.path} />
      <DialogBody>
        {value && <ConfigureForm value={value} onChange={setValue} />}
        {isAdoRemote(project.gitRemote) && (
          <FormSection title="Azure DevOps">
            <AdoConnectionForm projectId={project.id} />
          </FormSection>
        )}
      </DialogBody>
      <DialogFooter divided>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button disabled={!value || saving} onClick={() => value && void save(value)}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
