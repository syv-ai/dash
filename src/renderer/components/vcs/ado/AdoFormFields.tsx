import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import type { useAdoConnection, AdoTestOutcome } from './useAdoConnection';

type AdoConnectionState = ReturnType<typeof useAdoConnection>;

interface AdoFormFieldsProps {
  state: AdoConnectionState;
  autoFocusPat?: boolean;
}

export function AdoFormFields({ state, autoFocusPat }: AdoFormFieldsProps) {
  const { orgUrl, setOrgUrl, project, setProject, pat, setPat, setTestResult, isUrlValid } = state;

  return (
    <>
      <div>
        <label className="block text-xs text-fg-fade-50 mb-1">Organization URL</label>
        <input
          type="text"
          value={orgUrl}
          onChange={(e) => {
            setOrgUrl(e.target.value);
            setTestResult(null);
          }}
          placeholder="https://dev.azure.com/myorg"
          className={`w-full px-3 py-2 rounded-lg bg-background border text-foreground text-sm font-mono placeholder:text-muted-fade-30 focus:outline-hidden focus:ring-1 focus:ring-primary/40 focus:border-primary/40 ${
            orgUrl && !isUrlValid ? 'border-destructive/60' : 'border-input/60'
          }`}
        />
        {orgUrl && !isUrlValid && (
          <p className="text-xs text-destructive/70 mt-0.5">Must start with https://</p>
        )}
      </div>
      <div>
        <label className="block text-xs text-fg-fade-50 mb-1">Project</label>
        <input
          type="text"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setTestResult(null);
          }}
          placeholder="MyProject"
          className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-sm placeholder:text-muted-fade-30 focus:outline-hidden focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
      </div>
      <div>
        <label className="block text-xs text-fg-fade-50 mb-1">Personal Access Token</label>
        <input
          type="password"
          value={pat}
          onChange={(e) => {
            setPat(e.target.value);
            setTestResult(null);
          }}
          placeholder="Enter PAT..."
          autoFocus={autoFocusPat}
          className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-sm font-mono placeholder:text-muted-fade-30 focus:outline-hidden focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
      </div>
    </>
  );
}

export function AdoTestResult({ result }: { result: AdoTestOutcome | null }) {
  if (!result) return null;
  const ok = result === 'success';
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
        ok
          ? 'bg-[hsl(var(--git-added)/0.1)] text-[hsl(var(--git-added))]'
          : 'bg-destructive/10 text-destructive'
      }`}
    >
      {ok ? (
        <Check size={12} strokeWidth={2.5} className="shrink-0 mt-px" />
      ) : (
        <AlertCircle size={12} strokeWidth={2} className="shrink-0 mt-px" />
      )}
      <span className="break-words">{ok ? 'Connection successful' : result.error}</span>
    </div>
  );
}
