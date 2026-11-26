import React, { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { useModalClose } from '../ui/Modal';
import { Segmented } from '../ui/Segmented';
import { SourceStep, type ProjectSource } from './SourceStep';
import { LocationStep } from './LocationStep';
import { ConfigureForm } from './ConfigureForm';
import { configToValues, valuesToConfig, type ConfigureValues } from './types';

interface NewProjectWizardProps {
  onClose: () => void;
  /** Called after the project row is saved; receives the new project id. */
  onCreated: (projectId: string) => void;
}

type Step = 'source' | 'location' | 'configure';
interface Resolved {
  path: string;
  name: string;
  isGitRepo: boolean;
}

const STEP_ORDER: Step[] = ['source', 'location', 'configure'];
const STEP_TITLE: Record<Step, string> = {
  source: 'Source',
  location: 'Location',
  configure: 'Configure',
};
const STEP_HINT: Record<Step, string> = {
  source: 'Where the project comes from.',
  location: 'Where it lives on disk.',
  configure: 'Optional: defaults for its tasks. You can change them later.',
};

export function NewProjectWizard({ onClose, onCreated }: NewProjectWizardProps) {
  return (
    <Dialog size="lg" onClose={onClose}>
      <WizardBody onCreated={onCreated} />
    </Dialog>
  );
}

function WizardBody({ onCreated }: { onCreated: (id: string) => void }) {
  const close = useModalClose();
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<ProjectSource | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [values, setValues] = useState<ConfigureValues | null>(null);
  const [saving, setSaving] = useState(false);

  const reached = (s: Step): boolean => {
    if (s === 'source') return true;
    if (s === 'location') return source !== null;
    return resolved !== null;
  };

  async function handleResolved(info: Resolved) {
    setResolved(info);
    // Load any committed config (e.g. cloned repo ships .dash/config.json). Shared
    // only, since handleCreate writes it back to config.json.
    const resp = await window.electronAPI.readWorkspaceConfig(info.path, { shared: true });
    const config = resp.success ? (resp.data ?? null) : null;
    setValues(configToValues(config, { name: info.name, baseRef: 'origin/main' }));
    setStep('configure');
  }

  async function handleCreate() {
    if (!resolved || !values || saving) return;
    setSaving(true);
    try {
      // 1) Persist config.json (only meaningful keys; safe even if untouched).
      await window.electronAPI.writeWorkspaceConfig({
        projectPath: resolved.path,
        config: valuesToConfig(values),
      });
      // 2) Detect git for remote/branch, then save the project row.
      const gitResp = await window.electronAPI.detectGit(resolved.path);
      const gitInfo = gitResp.success ? gitResp.data : null;
      const saveResp = await window.electronAPI.saveProject({
        name: values.name.trim() || resolved.name,
        path: resolved.path,
        isGitRepo: gitInfo?.isGitRepo ?? resolved.isGitRepo,
        gitRemote: gitInfo?.remote ?? null,
        gitBranch: gitInfo?.branch ?? null,
        baseRef: values.baseRef.trim() || null,
      });
      if (saveResp.success && saveResp.data) {
        onCreated(saveResp.data.id);
        close();
      }
    } finally {
      setSaving(false);
    }
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  return (
    <>
      <DialogHeader title="New project" description={STEP_HINT[step]} />
      <DialogBody>
        <Segmented<Step>
          aria-label="Steps"
          size="sm"
          fullWidth={false}
          value={step}
          onChange={setStep}
          options={STEP_ORDER.map((s, i) => ({
            value: s,
            label: `${i + 1}. ${STEP_TITLE[s]}`,
            disabled: !reached(s),
          }))}
        />
        {step === 'source' && (
          <SourceStep
            onPick={(s) => {
              setSource(s);
              setResolved(null);
              setStep('location');
            }}
          />
        )}
        {step === 'location' && source && (
          <LocationStep source={source} onResolved={(info) => void handleResolved(info)} />
        )}
        {step === 'configure' && values && <ConfigureForm value={values} onChange={setValues} />}
      </DialogBody>
      <DialogFooter
        divided={step === 'configure'}
        start={
          stepIndex > 0 && (
            <Button variant="ghost" onClick={() => setStep(STEP_ORDER[stepIndex - 1]!)}>
              <ArrowLeft size={14} strokeWidth={1.8} />
              Back
            </Button>
          )
        }
      >
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button onClick={() => void handleCreate()} disabled={resolved === null || saving}>
          {saving && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {saving ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </>
  );
}
