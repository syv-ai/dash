import React, { useState } from 'react';
import { X, FolderOpen, Download, ArrowLeft, Loader2 } from 'lucide-react';

interface AddProjectModalProps {
  onClose: () => void;
  onOpenFolder: () => void;
  onCloneRepo: (url: string) => void;
  cloneStatus: { loading: boolean; error: string | null };
}

export function AddProjectModal({
  onClose,
  onOpenFolder,
  onCloneRepo,
  cloneStatus,
}: AddProjectModalProps) {
  const [step, setStep] = useState<'choose' | 'clone'>('choose');
  const [url, setUrl] = useState('');

  function handleClone(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) {
      onCloneRepo(url.trim());
    }
  }

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
          <h2 className="text-[14px] font-semibold text-foreground">Add Project</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="p-5">
          {step === 'choose' && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  onOpenFolder();
                }}
                className="flex items-center gap-3 px-4 py-3.5 rounded-lg border border-border/60 hover:border-border hover:bg-accent/40 transition-all duration-150 text-left group"
              >
                <div className="w-9 h-9 rounded-lg bg-accent/80 flex items-center justify-center flex-shrink-0 group-hover:bg-accent">
                  <FolderOpen size={18} className="text-foreground/70" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-foreground">Local folder</div>
                  <div className="text-[11px] text-muted-foreground/50">
                    Open an existing project directory
                  </div>
                </div>
              </button>

              <button
                onClick={() => setStep('clone')}
                className="flex items-center gap-3 px-4 py-3.5 rounded-lg border border-border/60 hover:border-border hover:bg-accent/40 transition-all duration-150 text-left group"
              >
                <div className="w-9 h-9 rounded-lg bg-accent/80 flex items-center justify-center flex-shrink-0 group-hover:bg-accent">
                  <Download size={18} className="text-foreground/70" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-foreground">Clone repository</div>
                  <div className="text-[11px] text-muted-foreground/50">
                    Clone a Git repository by URL
                  </div>
                </div>
              </button>
            </div>
          )}

          {step === 'clone' && (
            <form onSubmit={handleClone}>
              <div className="mb-5">
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                  Repository URL
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
                  autoFocus
                  disabled={cloneStatus.loading}
                />
              </div>

              {cloneStatus.error && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] text-destructive">
                  {cloneStatus.error}
                </div>
              )}

              <div className="flex gap-2.5 justify-between">
                <button
                  type="button"
                  onClick={() => setStep('choose')}
                  disabled={cloneStatus.loading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150 disabled:opacity-30"
                >
                  <ArrowLeft size={13} strokeWidth={2} />
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!url.trim() || cloneStatus.loading}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  {cloneStatus.loading && (
                    <Loader2 size={13} className="animate-spin" strokeWidth={2} />
                  )}
                  {cloneStatus.loading ? 'Cloning...' : 'Clone'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
