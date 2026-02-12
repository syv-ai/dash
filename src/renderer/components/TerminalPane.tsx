import React, { useRef, useEffect, useState } from 'react';
import { ExternalLink, Terminal, Copy, Check } from 'lucide-react';
import { sessionRegistry } from '../terminal/SessionRegistry';

interface TerminalPaneProps {
  id: string;
  cwd: string;
  autoApprove?: boolean;
  terminalEmulator?: 'builtin' | 'external';
  externalTerminalApp?: string;
}

export function TerminalPane({
  id,
  cwd,
  autoApprove,
  terminalEmulator = 'builtin',
  externalTerminalApp = 'Terminal',
}: TerminalPaneProps) {
  if (terminalEmulator === 'external') {
    return (
      <ExternalTerminalPlaceholder
        id={id}
        cwd={cwd}
        autoApprove={autoApprove}
        terminalApp={externalTerminalApp}
      />
    );
  }

  return <BuiltinTerminal id={id} cwd={cwd} autoApprove={autoApprove} />;
}

function BuiltinTerminal({
  id,
  cwd,
  autoApprove,
}: {
  id: string;
  cwd: string;
  autoApprove?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    sessionRegistry.attach({
      id,
      cwd,
      container,
      autoApprove,
    });

    return () => {
      sessionRegistry.detach(id);
    };
  }, [id, cwd, autoApprove]);

  return (
    <div
      ref={containerRef}
      className={`terminal-container w-full h-full relative transition-all duration-150 ${
        isDragOver ? 'ring-2 ring-inset ring-primary/30' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          const paths = Array.from(files).map((f) => (f as File & { path: string }).path);
          const session = sessionRegistry.get(id);
          if (session) {
            session.writeInput(paths.join(' '));
          }
        }
      }}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 pointer-events-none animate-fade-in">
          <div className="px-4 py-2 rounded-lg bg-primary/15 text-primary text-[12px] font-medium">
            Drop files to paste paths
          </div>
        </div>
      )}
    </div>
  );
}

function ExternalTerminalPlaceholder({
  id,
  cwd,
  autoApprove,
  terminalApp,
}: {
  id: string;
  cwd: string;
  autoApprove?: boolean;
  terminalApp: string;
}) {
  const [state, setState] = useState<{
    launched: boolean;
    command: string;
    autoLaunched: boolean;
    error?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const launchedRef = useRef(false);

  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;

    window.electronAPI
      .ptyLaunchExternal({
        id,
        cwd,
        terminalApp,
        autoApprove,
        resume: true,
      })
      .then((resp) => {
        if (resp.success && resp.data) {
          setState(resp.data);
        } else {
          setState({
            launched: false,
            command: `cd '${cwd}' && claude${autoApprove ? ' --dangerously-skip-permissions' : ''}`,
            autoLaunched: false,
            error: resp.error,
          });
        }
      });

    return () => {
      window.electronAPI.ptyUnregisterExternal(id);
    };
  }, [id, cwd, autoApprove, terminalApp]);

  function handleCopy() {
    if (!state) return;
    navigator.clipboard.writeText(state.command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleFocus() {
    // Re-launch just opens/focuses the app
    await window.electronAPI.ptyLaunchExternal({
      id,
      cwd,
      terminalApp,
      autoApprove,
    });
  }

  async function handleRelaunch() {
    setState(null);
    const resp = await window.electronAPI.ptyLaunchExternal({
      id,
      cwd,
      terminalApp,
      autoApprove,
      resume: true,
    });
    if (resp.success && resp.data) {
      setState(resp.data);
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-background">
      <div className="text-center max-w-md animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-primary/8 border border-primary/20 flex items-center justify-center mx-auto mb-5">
          <Terminal size={22} className="text-primary/70" strokeWidth={1.5} />
        </div>

        <h3 className="text-[15px] font-semibold text-foreground/90 mb-1.5">
          Running in {terminalApp}
        </h3>

        {state === null ? (
          <p className="text-[13px] text-muted-foreground/50 mb-4">Launching...</p>
        ) : state.autoLaunched ? (
          <p className="text-[13px] text-muted-foreground/50 mb-4">
            Claude session launched in {terminalApp}
          </p>
        ) : state.launched ? (
          <p className="text-[13px] text-muted-foreground/50 mb-4">
            {terminalApp} opened. Paste the command below to start Claude.
          </p>
        ) : (
          <p className="text-[13px] text-[hsl(var(--git-modified))] mb-4">
            Could not launch {terminalApp}. {state.error ? `${state.error}. ` : ''}
            Copy the command below and run it manually.
          </p>
        )}

        {/* Command display */}
        {state && !state.autoLaunched && (
          <div className="mb-4">
            <div
              className="text-left px-3 py-2.5 rounded-lg border border-border/60 text-[11px] font-mono text-foreground/70 break-all"
              style={{ background: 'hsl(var(--surface-2))' }}
            >
              {state.command}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-2">
          {state && !state.autoLaunched && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-all duration-150"
            >
              {copied ? (
                <>
                  <Check size={13} strokeWidth={2} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={13} strokeWidth={2} />
                  Copy Command
                </>
              )}
            </button>
          )}

          {state?.launched && (
            <button
              onClick={handleFocus}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border border-border/60 text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground transition-all duration-150"
            >
              <ExternalLink size={13} strokeWidth={2} />
              Focus {terminalApp}
            </button>
          )}

          {state && (
            <button
              onClick={handleRelaunch}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border border-border/60 text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground transition-all duration-150"
            >
              Relaunch
            </button>
          )}
        </div>

        {/* Directory info */}
        <p className="text-[10px] text-muted-foreground/30 font-mono mt-4 truncate px-4">{cwd}</p>
      </div>
    </div>
  );
}
