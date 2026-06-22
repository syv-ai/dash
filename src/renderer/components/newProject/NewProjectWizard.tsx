import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Modal, useModalClose } from '../ui/Modal';
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

export function NewProjectWizard({ onClose, onCreated }: NewProjectWizardProps) {
  return (
    <Modal onClose={onClose} size="w-[640px] max-h-[85vh]">
      <WizardBody onCreated={onCreated} />
    </Modal>
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
    // Load any committed config (e.g. cloned repo ships .dash/config.json).
    const resp = await window.electronAPI.readWorkspaceConfig(info.path);
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

  return (
    <>
      <div className="flex items-center justify-between px-5 h-12 border-b border-border/40">
        <h2 className="text-[14px] font-semibold text-foreground">New Project</h2>
        <button
          onClick={close}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 px-5 py-3 text-[11px] border-b border-border/30">
        {STEP_ORDER.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <span className="text-muted-foreground/30">—</span>}
            <button
              disabled={!reached(s)}
              onClick={() => setStep(s)}
              className={`px-2.5 py-1 rounded-full transition-colors ${
                step === s
                  ? 'bg-primary text-primary-foreground'
                  : reached(s)
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'text-muted-foreground/30'
              }`}
            >
              {i + 1} · {STEP_TITLE[s]}
              {s === 'configure' ? ' (optional)' : ''}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="p-5 overflow-y-auto">
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
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border/40">
        <button
          onClick={() => {
            const idx = STEP_ORDER.indexOf(step);
            if (idx > 0) setStep(STEP_ORDER[idx - 1]!);
          }}
          disabled={step === 'source'}
          className="text-[13px] text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
        >
          ← Back
        </button>
        <button
          onClick={() => void handleCreate()}
          disabled={resolved === null || saving}
          className="px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 transition-all"
        >
          {saving ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </>
  );
}
