import React, { useEffect, useState } from 'react';
import { toast } from '../ui/toast';
import { AdoConnectionForm } from '../vcs/ado/AdoConnectionForm';
import { isAdoRemote } from '../../../shared/urls';
import type { Project } from '../../../shared/types';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { FormSection } from '../ui/Field';
import { useModalClose } from '../ui/Modal';
import { ConfigureForm } from './ConfigureForm';
import {
  configToValues,
  localToValues,
  localValuesOk,
  valuesToConfig,
  valuesToLocal,
  type ConfigureValues,
  type LocalValues,
} from './configureValues';
import { LocalDefaultsForm } from './LocalDefaultsForm';

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
}

export function ProjectSettingsModal({ project, onClose, onRename }: ProjectSettingsModalProps) {
  return (
    <Dialog size="md" onClose={onClose}>
      <ProjectSettingsBody project={project} onRename={onRename} />
    </Dialog>
  );
}

function ProjectSettingsBody({ project, onRename }: Omit<ProjectSettingsModalProps, 'onClose'>) {
  const close = useModalClose();
  const [value, setValue] = useState<ConfigureValues | null>(null);
  const [local, setLocal] = useState<LocalValues | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Load the committed config once on open. Shared only: saving writes config.json,
  // so config.local.json overrides must not be read in. The personal,
  // local-only defaults come from config.local.json on their own.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.readWorkspaceConfig(project.path, { shared: true }),
      window.electronAPI.readLocalTaskDefaults(project.path),
    ]).then(([shared, own]) => {
      if (cancelled) return;
      const config = shared.success ? (shared.data ?? null) : null;
      setValue(
        configToValues(config, { name: project.name, baseRef: project.baseRef ?? 'origin/main' }),
      );
      setIgnored(config?.ignoredLocalOnlyKeys ?? []);
      setLocal(localToValues(own.success ? own.data : undefined));
    });
    return () => {
      cancelled = true;
    };
  }, [project.path, project.name, project.baseRef]);

  async function save(next: ConfigureValues, own: LocalValues) {
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
      const localResp = await window.electronAPI.writeLocalTaskDefaults({
        projectPath: project.path,
        defaults: valuesToLocal(own),
      });
      if (!localResp.success) {
        toast.error(localResp.error || 'Failed to save your own project settings');
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
        {local && <LocalDefaultsForm value={local} onChange={setLocal} ignored={ignored} />}
        {isAdoRemote(project.gitRemote) && (
          <FormSection title="Azure DevOps">
            <AdoConnectionForm projectId={project.id} />
          </FormSection>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          disabled={!value || !local || !localValuesOk(local) || saving}
          onClick={() => value && local && void save(value, local)}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
