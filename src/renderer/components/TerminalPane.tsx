import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown } from 'lucide-react';
import { sessionRegistry } from '../terminal/SessionRegistry';

const OVERLAY_MIN_MS = 2000;
const OVERLAY_FADE_MS = 300;

interface TerminalPaneProps {
  id: string;
  cwd: string;
  autoApprove?: boolean;
}

export function TerminalPane({ id, cwd, autoApprove }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

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
    const session = sessionRegistry.getOrCreate({ id, cwd, autoApprove });

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

    session.onScrollStateChange(setIsAtBottom);

    // Now attach — the async work will call onRestarting/onReady as needed
    session.attach(container);

    return () => {
      sessionRegistry.detach(id);
    };
  }, [id, cwd, autoApprove, hideOverlay]);

  return (
    <div
      className={`w-full h-full relative transition-all duration-150 ${
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
      <div ref={containerRef} className="terminal-container w-full h-full" />
      {showOverlay && (
        <div
          className="absolute inset-0 z-10 pointer-events-none dark:bg-[#1f1f1f] bg-[#fafafa] flex flex-col items-center justify-center gap-4"
          style={{
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
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 pointer-events-none animate-fade-in">
          <div className="px-4 py-2 rounded-lg bg-primary/15 text-primary text-[12px] font-medium">
            Drop files to paste paths
          </div>
        </div>
      )}
      {!isAtBottom && (
        <button
          onClick={() => {
            const session = sessionRegistry.get(id);
            session?.scrollToBottom();
          }}
          className="absolute bottom-4 right-4 z-10 w-8 h-8 rounded-full bg-accent/80 hover:bg-accent text-foreground/70 hover:text-foreground flex items-center justify-center shadow-md backdrop-blur-sm transition-all duration-150 hover:scale-105"
          title="Scroll to bottom"
        >
          <ArrowDown size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
