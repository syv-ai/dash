import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import type { useAdoConnection } from './useAdoConnection';

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
        <label className="block text-[11px] text-foreground/50 mb-1">Organization URL</label>
        <input
          type="text"
          value={orgUrl}
          onChange={(e) => {
            setOrgUrl(e.target.value);
            setTestResult(null);
          }}
          placeholder="https://dev.azure.com/myorg"
          className={`w-full px-3 py-2 rounded-lg bg-background border text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 ${
            orgUrl && !isUrlValid ? 'border-destructive/60' : 'border-input/60'
          }`}
        />
        {orgUrl && !isUrlValid && (
          <p className="text-[10px] text-destructive/70 mt-0.5">Must start with https://</p>
        )}
      </div>
      <div>
        <label className="block text-[11px] text-foreground/50 mb-1">Project</label>
        <input
          type="text"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setTestResult(null);
          }}
          placeholder="MyProject"
          className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
      </div>
      <div>
        <label className="block text-[11px] text-foreground/50 mb-1">Personal Access Token</label>
        <input
          type="password"
          value={pat}
          onChange={(e) => {
            setPat(e.target.value);
            setTestResult(null);
          }}
          placeholder="Enter PAT..."
          autoFocus={autoFocusPat}
          className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
      </div>
    </>
  );
}

export function AdoTestResult({ result }: { result: 'success' | 'error' | null }) {
  if (!result) return null;
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] ${
        result === 'success'
          ? 'bg-[hsl(var(--git-added)/0.1)] text-[hsl(var(--git-added))]'
          : 'bg-destructive/10 text-destructive'
      }`}
    >
      {result === 'success' ? (
        <Check size={12} strokeWidth={2.5} />
      ) : (
        <AlertCircle size={12} strokeWidth={2} />
      )}
      {result === 'success' ? 'Connection successful' : 'Connection failed — check credentials'}
    </div>
  );
}
