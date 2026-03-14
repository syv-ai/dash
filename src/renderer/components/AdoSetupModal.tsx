import React from 'react';
import { X } from 'lucide-react';
import { useAdoConnection } from './useAdoConnection';
import { AdoFormFields, AdoTestResult } from './AdoFormFields';

interface AdoSetupModalProps {
  projectId: string;
  organizationUrl: string;
  project: string;
  onClose: () => void;
}

export function AdoSetupModal({
  projectId,
  organizationUrl,
  project,
  onClose,
}: AdoSetupModalProps) {
  const conn = useAdoConnection({
    projectId,
    initialOrgUrl: organizationUrl,
    initialProject: project,
    onSaved: onClose,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[420px] animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <h2 className="text-[14px] font-semibold text-foreground">Azure DevOps Detected</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[12px] text-muted-foreground/70">
            This project uses an Azure DevOps remote. Add a Personal Access Token to enable work
            item linking.
          </p>

          <AdoFormFields state={conn} autoFocusPat />
          <AdoTestResult result={conn.testResult} />

          <div className="flex gap-2.5 justify-between pt-2">
            <button
              type="button"
              disabled={!conn.canSubmit || conn.testing}
              onClick={conn.handleTest}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium border border-border/60 text-foreground/70 hover:bg-accent/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
            >
              {conn.testing ? 'Testing...' : 'Test Connection'}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-[13px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={!conn.canSubmit || conn.saving}
                onClick={conn.handleSave}
                className="px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
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
