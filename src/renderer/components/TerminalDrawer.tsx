import React, { useRef, useEffect, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, X, Plus } from 'lucide-react';
import { sessionRegistry } from '../terminal/SessionRegistry';

interface TerminalTab {
  id: string;
  label: string;
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
  // Tab state — persisted to localStorage per task
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    try {
      const stored = localStorage.getItem(`shellTabs:${taskId}`);
      return stored ? JSON.parse(stored) : [{ id: shellId, label: '1' }];
    } catch {
      return [{ id: shellId, label: '1' }];
    }
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      return localStorage.getItem(`shellActiveTab:${taskId}`) ?? shellId;
    } catch {
      return shellId;
    }
  });

  // Persist tab state
  useEffect(() => {
    localStorage.setItem(`shellTabs:${taskId}`, JSON.stringify(tabs));
  }, [tabs, taskId]);

  useEffect(() => {
    localStorage.setItem(`shellActiveTab:${taskId}`, activeTabId);
  }, [activeTabId, taskId]);

  // Attach the active tab's session to the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Remove previous session's xterm DOM before attaching a new one,
    // since detach() leaves the element in place for React-driven unmounts.
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const session = sessionRegistry.getOrCreate({
      id: activeTabId,
      cwd,
      shellOnly: true,
    });
    session.attach(container, { autoFocus: false });

    return () => {
      sessionRegistry.detach(activeTabId);
    };
  }, [activeTabId, cwd]);

  // Focus terminal when the user explicitly expands the drawer
  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    const wasCollapsed = prevCollapsedRef.current;
    prevCollapsedRef.current = collapsed;

    if (wasCollapsed && !collapsed) {
      const session = sessionRegistry.get(activeTabId);
      if (session) {
        requestAnimationFrame(() => session.focus());
      }
    }
  }, [collapsed, activeTabId]);

  function handleAddTab() {
    const newId = `shell:${taskId}:t${Date.now()}`;
    const newTab: TerminalTab = { id: newId, label: String(tabs.length + 1) };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }

  function handleCloseTab(tabId: string) {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === tabId);
    const updated = tabs.filter((t) => t.id !== tabId);
    sessionRegistry.dispose(tabId);
    const newActive = activeTabId === tabId ? updated[Math.max(0, idx - 1)].id : activeTabId;
    setTabs(updated);
    setActiveTabId(newActive);
  }

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
          className="flex items-center h-8 flex-shrink-0 border-b border-border/40"
          style={{ background: 'hsl(var(--surface-1))' }}
        >
          <Terminal
            size={12}
            strokeWidth={1.8}
            className="flex-shrink-0 ml-3 mr-1.5 text-foreground/80"
          />
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-1 px-2 h-full border-b-2 cursor-pointer transition-colors flex-shrink-0 select-none ${
                tab.id === activeTabId
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span className="text-[11px] font-medium">{tab.label}</span>
              {tabs.length > 1 && (
                <button
                  className="w-3.5 h-3.5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  aria-label={`Close terminal ${tab.label}`}
                >
                  <X size={9} strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
          <button
            className="ml-1 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
            onClick={handleAddTab}
            aria-label="Add terminal"
          >
            <Plus size={11} strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <button
            onClick={onCollapse}
            className="p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
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
