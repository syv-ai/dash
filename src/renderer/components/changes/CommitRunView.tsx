import React, { useState } from 'react';
import { ChevronRight, Check, X, ArrowLeft, RotateCw, Minus } from 'lucide-react';
import type { CommitRunState, HookRecord, HookStatus } from './commitRunReducer';

interface CommitRunViewProps {
  state: Exclude<CommitRunState, { status: 'idle' } | { status: 'success' }>;
  /** Files that became unstaged because a hook rewrote them; 0 unless we're in failed state. */
  autoFixCount: number;
  onCancel: () => void;
  onBackToFiles: () => void;
  onStageFixesAndRetry: () => void;
}

const STATUS_ICON: Record<HookStatus, React.ReactNode> = {
  Passed: <Check size={12} strokeWidth={2.5} className="text-[hsl(var(--git-added))]" />,
  Failed: <X size={12} strokeWidth={2.5} className="text-[hsl(var(--destructive))]" />,
  Skipped: <Minus size={12} strokeWidth={2.5} className="text-muted-foreground" />,
};

export function CommitRunView({
  state,
  autoFixCount,
  onCancel,
  onBackToFiles,
  onStageFixesAndRetry,
}: CommitRunViewProps) {
  const failedHooks =
    state.status !== 'cancelled' ? state.hooks.filter((h) => h.status === 'Failed') : [];
  const passed = state.hooks.filter((h) => h.status === 'Passed').length;
  const failed = state.hooks.filter((h) => h.status === 'Failed').length;
  const skipped = state.hooks.filter((h) => h.status === 'Skipped').length;
  const hasAutoFix = autoFixCount > 0;
  const hasManual = failedHooks.some((h) => !h.modifiedFiles && (h.diagnostic ?? '').length > 0);

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--surface-1))]">
      <Header state={state} onCancel={onCancel} />
      {passed || failed || skipped ? (
        <div className="px-3 pt-2 flex gap-3 font-mono text-[11px]">
          {passed ? <span className="text-[hsl(var(--git-added))]">{passed} passed</span> : null}
          {failed ? <span className="text-[hsl(var(--destructive))]">{failed} failed</span> : null}
          {skipped ? <span className="text-muted-foreground">{skipped} skipped</span> : null}
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-1.5 py-2 flex flex-col gap-0.5">
        {state.hooks.map((h, i) => (
          <HookItem key={`${h.name}-${i}`} hook={h} />
        ))}
        {state.raw && (
          <pre className="mt-2 mx-2 p-2 rounded bg-[hsl(var(--surface-0))] text-[11px] font-mono text-foreground/80 whitespace-pre-wrap wrap-break-word">
            {state.raw}
          </pre>
        )}
      </div>
      {state.status === 'failed' && (
        <Footer
          hint={
            hasAutoFix && hasManual
              ? `${autoFixCount} files auto-fixed · some failures need manual fixes too`
              : hasAutoFix
                ? `${autoFixCount} files were auto-fixed and unstaged.`
                : 'Fix the reported errors, then commit again.'
          }
          primary={
            hasAutoFix
              ? {
                  label: `Stage ${autoFixCount} fixes & retry`,
                  icon: <RotateCw size={11} strokeWidth={2.5} />,
                  onClick: onStageFixesAndRetry,
                }
              : undefined
          }
          secondary={{
            label: 'Back to files',
            icon: <ArrowLeft size={11} strokeWidth={2.5} />,
            onClick: onBackToFiles,
          }}
        />
      )}
      {state.status === 'cancelled' && (
        <Footer
          secondary={{
            label: 'Back to files',
            icon: <ArrowLeft size={11} strokeWidth={2.5} />,
            onClick: onBackToFiles,
          }}
        />
      )}
    </div>
  );
}

function Header({ state, onCancel }: { state: CommitRunViewProps['state']; onCancel: () => void }) {
  const isRunning = state.status === 'running';
  const isFailed = state.status === 'failed';
  const isCancelled = state.status === 'cancelled';
  const bgClass = isFailed
    ? 'bg-[hsl(var(--destructive)/0.14)] text-[hsl(var(--destructive))]'
    : isCancelled
      ? 'bg-[hsl(var(--muted-foreground)/0.15)] text-muted-foreground'
      : 'bg-[hsl(var(--primary)/0.12)] text-primary';
  const subtitle = isRunning
    ? `hook ${state.hooks.length} so far`
    : isCancelled
      ? 'no commit created'
      : 'pre-commit';
  return (
    <div className="shrink-0 flex items-center gap-2.5 px-3.5 pt-3 pb-2.5 border-b border-border/40">
      <span
        className={`w-7 h-7 rounded-md inline-flex items-center justify-center shrink-0 ${bgClass}`}
      >
        {isRunning ? <Spinner /> : <X size={14} strokeWidth={2.5} />}
      </span>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-[12.5px] font-medium text-foreground">
          {isRunning ? 'Running pre-commit' : isFailed ? titleForFailed(state) : 'Cancelled'}
        </span>
        <span className="text-[10.5px] font-mono text-muted-foreground">{subtitle}</span>
      </div>
      {isRunning && (
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-[11px] rounded border border-border/40 bg-[hsl(var(--surface-2))] text-foreground/80 hover:bg-[hsl(var(--destructive)/0.16)] hover:border-[hsl(var(--destructive)/0.4)] hover:text-destructive inline-flex items-center gap-1"
        >
          <X size={11} strokeWidth={2.5} />
          Cancel
        </button>
      )}
    </div>
  );
}

function titleForFailed(state: Extract<CommitRunState, { status: 'failed' }>): string {
  const failedHooks = state.hooks.filter((h) => h.status === 'Failed');
  if (failedHooks.length === 0) return 'Commit failed';
  return `${failedHooks.length} hook${failedHooks.length === 1 ? '' : 's'} need fixes`;
}

function HookItem({ hook }: { hook: HookRecord }) {
  const [open, setOpen] = useState(false);
  const expandable = hook.diagnostic.length > 0 || hook.modifiedFiles === true;
  return (
    <div className={`rounded-md overflow-hidden ${open ? 'bg-[hsl(var(--surface-2)/0.4)]' : ''}`}>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-[hsl(var(--surface-2)/0.4)] ${
          expandable ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
          {STATUS_ICON[hook.status]}
        </span>
        <span
          className={`flex-1 min-w-0 font-mono text-[12px] truncate ${
            hook.status === 'Failed' ? 'text-destructive' : 'text-foreground'
          }`}
        >
          {hook.name}
        </span>
        {hook.duration != null && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {hook.duration.toFixed(1)}s
          </span>
        )}
        {expandable && (
          <ChevronRight
            size={12}
            strokeWidth={2}
            className={`text-muted-foreground/60 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {open && expandable && (
        <div className="bg-[hsl(var(--surface-0))] border-t border-border/40 px-3.5 py-2.5 max-h-60 overflow-y-auto text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-foreground/85">
          {hook.modifiedFiles && (
            <div className="text-[hsl(var(--warn))] mb-1">files were modified by this hook</div>
          )}
          {hook.diagnostic}
        </div>
      )}
    </div>
  );
}

function Footer({
  hint,
  primary,
  secondary,
}: {
  hint?: string;
  primary?: { label: string; icon: React.ReactNode; onClick: () => void };
  secondary?: { label: string; icon: React.ReactNode; onClick: () => void };
}) {
  return (
    <div className="shrink-0 border-t border-border/40 p-2.5 flex flex-col gap-2">
      {hint && <span className="text-[10.5px] text-muted-foreground px-1">{hint}</span>}
      <div className="flex gap-1.5">
        {primary && (
          <button
            onClick={primary.onClick}
            className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-md text-[12px] font-medium hover:bg-primary/90"
          >
            {primary.icon}
            {primary.label}
          </button>
        )}
        {secondary && (
          <button
            onClick={secondary.onClick}
            className={`${primary ? 'px-3.5' : 'flex-1'} h-8 inline-flex items-center justify-center gap-1.5 bg-[hsl(var(--surface-2))] border border-border/40 text-foreground/80 rounded-md text-[12px] hover:bg-[hsl(var(--surface-3))]`}
          >
            {secondary.icon}
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="block w-3 h-3 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
  );
}
