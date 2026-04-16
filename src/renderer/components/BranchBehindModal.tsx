import { X, GitBranch, ArrowDown } from 'lucide-react';

interface BranchBehindModalProps {
  branch: string;
  behind: number;
  onUpdate: () => void;
  onSkip: () => void;
}

export function BranchBehindModal({ branch, behind, onUpdate, onSkip }: BranchBehindModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onSkip}
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
          <h2 className="text-[14px] font-semibold text-foreground">Branch Behind Remote</h2>
          <button
            onClick={onSkip}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 mt-0.5">
              <ArrowDown size={16} strokeWidth={2} />
            </div>
            <div>
              <p className="text-[13px] text-foreground mb-1">
                Local branch{' '}
                <code className="px-1.5 py-0.5 rounded bg-surface-1 text-[12px] font-mono">
                  {branch}
                </code>{' '}
                is{' '}
                <span className="font-medium text-amber-500">
                  {behind} commit{behind !== 1 ? 's' : ''}
                </span>{' '}
                behind the remote.
              </p>
              <p className="text-[12px] text-muted-foreground">
                Would you like to update it before creating the task?
              </p>
            </div>
          </div>

          <div className="flex gap-2.5 justify-end">
            <button
              type="button"
              onClick={onSkip}
              className="px-4 py-2 rounded-full text-[13px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onUpdate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all duration-150"
            >
              <GitBranch size={13} strokeWidth={2} />
              Update
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
