import React, { useRef, useEffect, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import { sessionRegistry } from '../terminal/SessionRegistry';

/**
 * Shorten a path for display: `[...]/parentOfInitial/current/sub/dirs`.
 * If the user navigates outside the initial tree, falls back to last 2 segments.
 */
function shortenCwd(current: string, initial: string): string {
  if (current === '/') return '/';
  const initialParts = initial.split('/');
  // Anchor = grandparent of initial cwd (parent of the parent dir)
  // e.g., initial=/a/b/c → grandparent=/a → show [...]/b/c, [...]/b/c/d, etc.
  const grandparent = initialParts.slice(0, -2).join('/') || '/';
  const prefix = grandparent === '/' ? '/' : grandparent + '/';

  if (current.startsWith(prefix) && current.length > prefix.length) {
    return '[...] /' + current.slice(prefix.length);
  }

  // Fallback: show last 2 non-empty segments
  const parts = current.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  if (parts.length <= 2) return '/' + parts.join('/');
  return '[...] /' + parts.slice(-2).join('/');
}

interface TerminalDrawerProps {
  taskId: string;
  cwd: string;
  collapsed: boolean;
  label?: string;
  onCollapse: () => void;
  onExpand: () => void;
}

export function TerminalDrawer({
  taskId,
  cwd,
  collapsed,
  label = 'Terminal',
  onCollapse,
  onExpand,
}: TerminalDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shellId = `shell:${taskId}`;
  const [displayCwd, setDisplayCwd] = useState(cwd);

  // Reset displayCwd when the task's cwd prop changes (e.g. switching tasks)
  useEffect(() => {
    setDisplayCwd(cwd);
  }, [cwd]);

  // Attach once and keep alive across collapse/expand
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const session = sessionRegistry.getOrCreate({
      id: shellId,
      cwd,
      shellOnly: true,
    });
    session.attach(container, { autoFocus: false });

    setDisplayCwd(session.currentCwd);

    session.onCwdChange((newCwd) => {
      setDisplayCwd(newCwd);
    });

    return () => {
      sessionRegistry.detach(shellId);
    };
  }, [shellId, cwd]);

  // Focus terminal when the user explicitly expands the drawer
  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    const wasCollapsed = prevCollapsedRef.current;
    prevCollapsedRef.current = collapsed;

    if (wasCollapsed && !collapsed) {
      const session = sessionRegistry.get(shellId);
      if (session) {
        requestAnimationFrame(() => session.focus());
      }
    }
  }, [collapsed, shellId]);

  return (
    <div className="h-full flex flex-col">
      {collapsed ? (
        <button
          onClick={onExpand}
          className="h-full w-full flex items-center gap-2 px-4 text-foreground/80 hover:text-foreground transition-colors"
          style={{ background: 'hsl(var(--surface-1))' }}
        >
          <Terminal size={12} strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</span>
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <div
          className="flex items-center gap-2 px-3 h-8 flex-shrink-0 border-b border-border/40"
          style={{ background: 'hsl(var(--surface-1))' }}
        >
          <Terminal size={12} strokeWidth={1.8} className="text-foreground/80" />
          <span className="text-[11px] font-semibold uppercase text-foreground/80 tracking-[0.08em]">
            {label}
          </span>
          <span className="text-[11px] font-mono text-muted-foreground/50 truncate flex-1">
            {shortenCwd(displayCwd, cwd)}
          </span>
          <button
            onClick={onCollapse}
            className="p-1 rounded hover:bg-accent text-muted-foreground/40 hover:text-foreground transition-colors"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        </div>
      )}
      {/* Terminal container always in DOM to avoid re-attach on expand */}
      <div
        ref={containerRef}
        className="terminal-container terminal-drawer flex-1 min-h-0"
        style={collapsed ? { height: 0, overflow: 'hidden' } : undefined}
      />
    </div>
  );
}
