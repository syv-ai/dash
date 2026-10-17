import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { SearchAddon } from '@xterm/addon-search';
import { Loader2, PlugZap } from 'lucide-react';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { droppedPathsText } from '../../terminal/dropPaths';
import type { DetachedInfo } from '../../terminal/TerminalSessionManager';
import type { PermissionMode } from '../../../shared/types';
import { TerminalSearch } from './TerminalSearch';
import { Button } from '../ui/Button';

const OVERLAY_MIN_MS = 2000;
const OVERLAY_FADE_MS = 300;

interface TerminalPaneProps {
  id: string;
  cwd: string;
  permissionMode?: PermissionMode;
  terminalBg?: string;
}

export function TerminalPane({ id, cwd, permissionMode, terminalBg }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  // Agent panes: set when the `claude attach` client exited. The session keeps
  // running under Claude Code's supervisor; Re-attach opens a new client.
  // `reconnecting`: Dash cycled the session and the pane re-attaches itself.
  const [detached, setDetached] = useState<DetachedInfo | null>(null);

  const hideOverlay = useCallback(() => {
    // Start fade-out
    setOverlayVisible(false);
    // Remove from DOM after transition
    setTimeout(() => setShowOverlay(false), OVERLAY_FADE_MS);
  }, []);

  const overlayStartRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Get or create session first so we can register callbacks
    // before the async attach() work detects a restart
    const session = sessionRegistry.getOrCreate({ id, cwd, permissionMode });

    session.onRestarting(() => {
      overlayStartRef.current = Date.now();
      setShowOverlay(true);
      setOverlayVisible(true);
    });

    session.onReady(() => {
      const elapsed = Date.now() - overlayStartRef.current;
      const remaining = Math.max(0, OVERLAY_MIN_MS - elapsed);
      setTimeout(hideOverlay, remaining);
    });

    session.onDetached((info) => setDetached(info));

    // Wire find shortcut: xterm consumes keystrokes while focused, so the
    // intercept lives at the session layer (see TerminalSessionManager).
    session.setOnFindKey(() => setShowSearch(true));
    setSearchAddon(session.getSearchAddon());

    // Now attach — the async work will call onRestarting/onReady as needed
    void session.attach(container);

    return () => {
      session.setOnFindKey(null);
      session.onDetached(null);
      sessionRegistry.detach(id);
    };
  }, [id, cwd, permissionMode, hideOverlay]);

  const reattach = useCallback(() => {
    void sessionRegistry.get(id)?.reattach();
  }, [id]);

  return (
    <div
      className={`w-full h-full relative transition-shadow duration-150 ${
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
        const { electronAPI } = window;
        const paths = Array.from(e.dataTransfer.files).map((f) => electronAPI.getPathForFile(f));
        const text = droppedPathsText(paths, electronAPI.getPlatform());
        if (text) sessionRegistry.get(id)?.paste(text);
      }}
    >
      <div ref={containerRef} className="terminal-container w-full h-full" />
      {showSearch && searchAddon && (
        <TerminalSearch searchAddon={searchAddon} onClose={() => setShowSearch(false)} />
      )}
      {showOverlay && (
        <div
          className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center gap-4"
          style={{
            background: terminalBg,
            opacity: overlayVisible ? 1 : 0,
            transition: `opacity ${OVERLAY_FADE_MS}ms ease-out`,
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            className="w-16 h-16 opacity-60 animate-pulse"
          >
            <defs>
              <linearGradient id="restart-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#0a0a0a' }} />
                <stop offset="100%" style={{ stopColor: '#1a1a2e' }} />
              </linearGradient>
              <linearGradient id="restart-dash" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style={{ stopColor: '#00ff88' }} />
                <stop offset="100%" style={{ stopColor: '#00cc6a' }} />
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="108" fill="url(#restart-bg)" />
            <rect x="136" y="240" width="240" height="36" rx="18" fill="url(#restart-dash)" />
            <rect x="396" y="232" width="4" height="52" rx="2" fill="#00ff88" opacity="0.7" />
          </svg>
          <span className="text-[13px] dark:text-neutral-400 text-neutral-500 font-medium">
            Resuming your session...
          </span>
        </div>
      )}
      {detached?.reconnecting && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 animate-fade-in"
          style={{ background: terminalBg }}
        >
          <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-muted-fade-60" />
          <span className="text-[12px] text-muted-foreground">Reconnecting…</span>
        </div>
      )}
      {detached && !detached.reconnecting && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center animate-fade-in"
          style={{ background: terminalBg }}
        >
          <div
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl border border-border/40 text-center max-w-[360px]"
            style={{ background: 'hsl(var(--surface-2))' }}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent/80 text-muted-foreground">
              <PlugZap size={16} strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-foreground">Detached from session</p>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed mt-1">
                The session keeps running under Claude Code. Re-attach to pick up where it is, with
                a recap of what happened meanwhile.
              </p>
            </div>
            <Button size="sm" onClick={reattach}>
              Re-attach
            </Button>
            <p className="text-[10.5px] text-muted-fade-60 leading-relaxed">
              Inside the pane: <kbd className="font-mono">←</kbd> on an empty prompt opens agent
              view, <kbd className="font-mono">Esc</kbd> leaves it,{' '}
              <kbd className="font-mono">Ctrl+Z</kbd> detaches.
            </p>
          </div>
        </div>
      )}
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
