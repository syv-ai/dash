import React, { useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { useAdoConnection, useAdoConnectionLoader } from './useAdoConnection';
import { AdoFormFields, AdoTestResult } from './AdoFormFields';

interface AdoConnectionFormProps {
  projectId?: string;
}

export function AdoConnectionForm({ projectId }: AdoConnectionFormProps) {
  const [enabled, setEnabled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [configured, setConfigured] = useState(false);

  const conn = useAdoConnection({
    projectId,
    onSaved: () => setConfigured(true),
  });

  useAdoConnectionLoader(conn, projectId, setEnabled, setConfigured);

  async function handleToggle() {
    if (enabled) {
      await window.electronAPI.adoRemoveConfig(projectId);
      conn.setOrgUrl('');
      conn.setProject('');
      conn.setPat('');
      conn.setTestResult(null);
      setConfigured(false);
      setExpanded(false);
      setEnabled(false);
    } else {
      setEnabled(true);
      setExpanded(true);
    }
  }

  return (
    <div
      className="rounded-xl border border-border/40"
      style={{ background: 'hsl(var(--surface-2))' }}
    >
      <div className="flex items-center gap-3.5 w-full p-4">
        <button
          type="button"
          onClick={() => {
            if (enabled) setExpanded(!expanded);
          }}
          className={`flex items-center gap-3.5 flex-1 min-w-0 text-left ${enabled ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              configured ? 'bg-[hsl(var(--git-added)/0.12)]' : 'bg-accent/60'
            }`}
          >
            {configured ? (
              <Check size={14} className="text-[hsl(var(--git-added))]" strokeWidth={2.5} />
            ) : (
              <AlertCircle size={14} className="text-muted-foreground/40" strokeWidth={2} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground/90">Azure DevOps</p>
            <p className="text-[11px] text-foreground/50">
              {configured ? 'Connected' : 'Not configured'}
            </p>
          </div>
        </button>
        <button type="button" onClick={handleToggle} className="flex-shrink-0">
          <div
            className={`w-8 h-[18px] rounded-full relative transition-colors duration-150 ${
              enabled ? 'bg-primary' : 'bg-border'
            }`}
          >
            <div
              className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-150 ${
                enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'
              }`}
            />
          </div>
        </button>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 space-y-2.5">
            <AdoFormFields state={conn} />
            <AdoTestResult result={conn.testResult} />

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={!conn.canSubmit || conn.testing}
                onClick={conn.handleTest}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium border border-border/60 text-foreground/70 hover:bg-accent/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
              >
                {conn.testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                type="button"
                disabled={!conn.canSubmit || conn.saving}
                onClick={conn.handleSave}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
              >
                {conn.saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
