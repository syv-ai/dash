import React, { useRef, useEffect, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, X, Plus, Settings2, ScrollText } from 'lucide-react';
import { sessionRegistry } from '../terminal/SessionRegistry';
import type { Tab } from '../../shared/drawerTabs';

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
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Subscribe to main's drawer-tabs feed. On first mount of a task that has no
  // rows yet, seed the default shell tab so we don't render an empty header.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const [listResp, activeResp] = await Promise.all([
        window.electronAPI.drawerTabsList(taskId),
        window.electronAPI.drawerTabsGetActive(taskId),
      ]);
      if (cancelled) return;
      if (listResp.success && listResp.data) setTabs(listResp.data);
      if (activeResp.success) setActiveTabId(activeResp.data ?? null);
    };

    refresh();
    window.electronAPI.drawerTabsSubscribe(taskId);
    const off = window.electronAPI.onDrawerTabsChanged((changedTaskId) => {
      if (changedTaskId === taskId) refresh();
    });

    // Seed the first shell tab if none exist yet. Idempotent — once the row
    // lands in SQLite, this branch never fires again for the task.
    (async () => {
      const r = await window.electronAPI.drawerTabsList(taskId);
      if (cancelled) return;
      if (r.success && r.data && r.data.length === 0) {
        await window.electronAPI.drawerTabsAdd(taskId, {
          kind: 'shell',
          label: '1',
          id: shellId,
        });
      }
    })();

    return () => {
      cancelled = true;
      off();
      window.electronAPI.drawerTabsUnsubscribe(taskId);
    };
  }, [taskId, shellId]);

  // Attach the active tab's session to the container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeTabId) return;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const activeTab = tabs.find((t) => t.id === activeTabId);
    // 'service' tabs are TUI-like for attach purposes: the PTY was spawned by
    // main (never self-spawn a shell) and output won't redraw on reattach, so
    // the snapshot replays.
    const isTui = activeTab?.kind === 'tui' || activeTab?.kind === 'service';

    const session = sessionRegistry.getOrCreate({
      id: activeTabId,
      cwd,
      shellOnly: true,
      isTui,
    });
    session.attach(container, { autoFocus: false });

    return () => {
      sessionRegistry.detach(activeTabId);
    };
  }, [activeTabId, cwd, tabs]);

  // Logs button with a Dash-owned tab: main asks us to surface that tab.
  useEffect(() => {
    const off = window.electronAPI.onPortsServiceFocusTab(({ taskId: tid, tabId }) => {
      if (tid !== taskId) return;
      onExpand();
      window.electronAPI.drawerTabsSetActive(taskId, tabId);
    });
    return off;
  }, [taskId, onExpand]);

  // Focus terminal when the user explicitly expands the drawer
  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    const wasCollapsed = prevCollapsedRef.current;
    prevCollapsedRef.current = collapsed;

    if (wasCollapsed && !collapsed && activeTabId) {
      const session = sessionRegistry.get(activeTabId);
      if (session) {
        requestAnimationFrame(() => session.focus());
      }
    }
  }, [collapsed, activeTabId]);

  function handleAddTab() {
    window.electronAPI.drawerTabsAdd(taskId, {
      kind: 'shell',
      label: String(tabs.length + 1),
      id: `shell:${taskId}:t${Date.now()}`,
    });
  }

  function handleCloseTab(tabId: string) {
    if (tabs.length <= 1) return;
    sessionRegistry.dispose(tabId);
    window.electronAPI.drawerTabsClose(tabId);
  }

  function handleSelectTab(tabId: string) {
    window.electronAPI.drawerTabsSetActive(taskId, tabId);
  }

  return (
    <div className="h-full flex flex-col">
      {collapsed ? (
        <button
          onClick={onExpand}
          className="h-full w-full flex items-center gap-2 px-4 text-foreground/80 hover:text-foreground transition-colors border-t border-white/[0.08] hover:bg-white/[0.04]"
        >
          <Terminal size={12} strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</span>
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <div className="flex items-center h-8 flex-shrink-0 border-t border-white/[0.08]">
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
              onClick={() => handleSelectTab(tab.id)}
            >
              {tab.kind === 'tui' && (
                <Settings2 size={11} strokeWidth={1.8} className="opacity-80" />
              )}
              {tab.kind === 'service' && (
                <ScrollText size={11} strokeWidth={1.8} className="opacity-80" />
              )}
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
