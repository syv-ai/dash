import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { X, RotateCw, Loader2, CircleAlert, CircleCheck } from 'lucide-react';
import { stripAnsi } from '../../../shared/setupRuns';
import { useSetup } from '../../stores/setupStore';
import { useProjects } from '../../stores/projectsStore';
import { Modal, useModalClose } from '../ui/Modal';
import { Button } from '../ui/Button';

/** The worktree setup output for `useSetup().viewPath`, live while it runs. */
export function SetupLogModal() {
  const viewPath = useSetup((s) => s.viewPath);
  const closeLog = useSetup((s) => s.closeLog);
  if (!viewPath) return null;
  return (
    <Modal onClose={closeLog} size="w-[760px] max-w-[90vw] h-[70vh]">
      <SetupLogBody worktreePath={viewPath} />
    </Modal>
  );
}

function SetupLogBody({ worktreePath }: { worktreePath: string }) {
  const close = useModalClose();
  const run = useSetup((s) => s.runs[worktreePath]);
  const log = useSetup((s) => s.viewLog);
  const rerun = useSetup((s) => s.rerun);
  const task = useProjects((s) => {
    for (const list of Object.values(s.tasksByProject)) {
      const t = list.find((x) => x.path === worktreePath);
      if (t) return t;
    }
    return null;
  });

  const text = useMemo(() => (log ? stripAnsi(log.text) : ''), [log]);

  // Follow the output while the view is scrolled to the bottom; leave it
  // where it is once the user scrolls up to read.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  // A new run starts at the bottom again.
  useEffect(() => {
    if (run?.status === 'running') pinnedRef.current = true;
  }, [run?.startedAt, run?.status]);

  const running = run?.status === 'running';
  return (
    <>
      <div className="flex items-center gap-3 px-5 h-12 border-b border-border/40 shrink-0">
        <h2 className="text-[14px] font-semibold text-foreground truncate">
          Setup{task ? ` · ${task.name}` : ''}
        </h2>
        <RunStatus status={run?.status} error={run?.error ?? null} />
        <div className="ml-auto flex items-center gap-1.5">
          {task && (
            <Button
              variant="secondary"
              size="sm"
              disabled={running}
              onClick={() => void rerun(task)}
            >
              <RotateCw size={12} strokeWidth={1.8} />
              Run setup again
            </Button>
          )}
          <button
            onClick={close}
            className="p-1.5 rounded-lg hover:bg-accent text-fg-fade-50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="flex-1 min-h-0 overflow-auto px-5 py-3"
      >
        {log?.trimmed && (
          <p className="text-[11px] text-muted-fade-50 mb-2">Earlier output was trimmed.</p>
        )}
        {!log ? (
          <p className="text-[12px] text-muted-fade-50">Loading…</p>
        ) : text ? (
          <pre className="text-[11px] leading-[1.5] font-mono text-fg-fade-80 whitespace-pre-wrap break-words select-text">
            {text}
          </pre>
        ) : (
          <p className="text-[12px] text-muted-fade-50">
            {running ? 'No output yet.' : 'The setup printed nothing.'}
          </p>
        )}
      </div>
    </>
  );
}

function RunStatus({ status, error }: { status?: string; error: string | null }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
        <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
        Running
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-destructive min-w-0"
        title={error ?? undefined}
      >
        <CircleAlert size={12} strokeWidth={1.8} className="shrink-0" />
        <span className="truncate">Failed</span>
      </span>
    );
  }
  if (status === 'succeeded') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--git-added))] shrink-0">
        <CircleCheck size={12} strokeWidth={1.8} />
        Done
      </span>
    );
  }
  return null;
}
