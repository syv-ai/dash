import React, { useRef, useEffect, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, X, Plus, ScrollText } from 'lucide-react';
import { sessionRegistry } from '../terminal/SessionRegistry';
import { Tooltip } from './ui/Tooltip';
import { nextShellLabel } from '../utils/shellTabLabel';
import type { Tab } from '../../shared/drawerTabs';

/** Minimum drawer height (px) for a side-car TUI's CTA start screen. */
const MIN_TUI_DRAWER_PX = 300;
/** Rough canvas px (52 cols × ~8px) if the real measurement never lands. */
const TUI_COLS_FALLBACK_PX = 420;

interface TerminalDrawerProps {
  taskId: string;
  cwd: string;
  collapsed: boolean;
  label?: string;
  onCollapse: () => void;
  onExpand: () => void;
  /** Grow the drawer to at least this many px (expands first if collapsed). */
  onEnsureHeight?: (px: number) => void;
  /**
   * Fires true while a side-car TUI tab is the active tab (with the pinned
   * canvas width in px so the host can size the panel to hug it), false
   * otherwise.
   */
  onTuiActiveChange?: (active: boolean, canvasPx?: number) => void;
}

export function TerminalDrawer({
  taskId,
  cwd,
  collapsed,
  label = 'Terminal',
  onCollapse,
  onExpand,
  onEnsureHeight,
  onTuiActiveChange,
}: TerminalDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shellId = `shell:${taskId}`;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [livePtyIds, setLivePtyIds] = useState<Set<string>>(new Set());
  // TUI tabs pulse as a "hot" notification until first activated.
  const [seenTuiIds, setSeenTuiIds] = useState<Set<string>>(new Set());
  const pendingFocusRef = useRef<string | null>(null);

  // Subscribe to main's drawer-tabs feed. On first mount of a task that has no
  // rows yet, seed the default shell tab so we don't render an empty header.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const [listResp, activeResp, liveResp] = await Promise.all([
        window.electronAPI.drawerTabsList(taskId),
        window.electronAPI.drawerTabsGetActive(taskId),
        window.electronAPI.ptyListForTask(taskId, { kinds: ['tui', 'service'] }),
      ]);
      if (cancelled) return;
      if (listResp.success && listResp.data) setTabs(listResp.data);
      if (activeResp.success) setActiveTabId(activeResp.data ?? null);
      if (liveResp.success && liveResp.data) setLivePtyIds(new Set(liveResp.data));
    };

    refresh();
    window.electronAPI.drawerTabsSubscribe(taskId);
    const off = window.electronAPI.onDrawerTabsChanged((changedTaskId) => {
      if (changedTaskId === taskId) refresh();
    });
    const offService = window.electronAPI.onPortsServiceChanged(({ taskId: tid }) => {
      if (tid === taskId) refresh();
    });

    // Seed the first shell tab if the task has no shell tabs yet. Checked by
    // kind, not list length — a TUI tab racing in first (fresh task spawning
    // its onboarding CTA) must not starve the task of its shell. Idempotent —
    // once the row lands in SQLite, this branch never fires again.
    (async () => {
      const r = await window.electronAPI.drawerTabsList(taskId);
      if (cancelled) return;
      if (r.success && r.data && !r.data.some((t) => t.kind === 'shell')) {
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
      offService();
      window.electronAPI.drawerTabsUnsubscribe(taskId);
    };
  }, [taskId, shellId]);

  // A main-spawned PTY (service/tui) dying on its own pushes no service-changed
  // event — drop its dot the moment its exit reaches the renderer.
  useEffect(() => {
    const offs = tabs
      .filter((t) => t.kind === 'service' || t.kind === 'tui')
      .map((t) =>
        window.electronAPI.onPtyExit(t.id, () => {
          setLivePtyIds((prev) => {
            if (!prev.has(t.id)) return prev;
            const next = new Set(prev);
            next.delete(t.id);
            return next;
          });
        }),
      );
    return () => offs.forEach((off) => off());
  }, [tabs]);

  // Activating a TUI tab marks it seen (stops the hot pulse) and grows the
  // drawer so the CTA screen fits.
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab?.kind !== 'tui') return;
    setSeenTuiIds((prev) => {
      if (prev.has(activeTab.id)) return prev;
      const next = new Set(prev);
      next.add(activeTab.id);
      return next;
    });
    onEnsureHeight?.(MIN_TUI_DRAWER_PX);
  }, [activeTabId, tabs, onEnsureHeight]);

  // Report whether a side-car TUI is the active tab so the host can size the
  // panel to hug its pinned canvas. The canvas is fixed-width, so its px is
  // stable once rendered — measure after a couple of frames. Reset to false
  // on unmount (task switch) so the panel restores for the next task.
  const activeKind = tabs.find((t) => t.id === activeTabId)?.kind;
  useEffect(() => {
    if (activeKind !== 'tui') {
      onTuiActiveChange?.(false);
      return;
    }
    // The pinned canvas lays out a frame or two after attach — poll briefly
    // for a real width, then fall back to a rough estimate so the panel still
    // sizes if measurement never lands.
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const session = activeTabId ? sessionRegistry.get(activeTabId) : undefined;
      const px = session?.getCanvasWidthPx() ?? 0;
      if (px > 0) {
        onTuiActiveChange?.(true, px);
      } else if (tries++ < 8) {
        raf = requestAnimationFrame(measure);
      } else {
        onTuiActiveChange?.(true, TUI_COLS_FALLBACK_PX);
      }
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [activeKind, activeTabId, onTuiActiveChange]);
  useEffect(() => {
    return () => onTuiActiveChange?.(false);
  }, [onTuiActiveChange]);

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
    const autoFocus = pendingFocusRef.current === activeTabId;
    if (autoFocus) pendingFocusRef.current = null;
    session.attach(container, { autoFocus });

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

  async function handleAddTab() {
    const id = `shell:${taskId}:t${Date.now()}`;
    pendingFocusRef.current = id;
    await window.electronAPI.drawerTabsAdd(taskId, {
      kind: 'shell',
      label: nextShellLabel(tabs.map((t) => t.label)),
      id,
    });
    window.electronAPI.drawerTabsSetActive(taskId, id);
  }

  function handleCloseTab(tabId: string) {
    if (tabs.length <= 1) return;
    sessionRegistry.dispose(tabId);
    window.electronAPI.drawerTabsClose(tabId);
  }

  function handleSelectTab(tabId: string) {
    window.electronAPI.drawerTabsSetActive(taskId, tabId);
  }

  function renderTab(tab: Tab) {
    // TUI tabs are Dash speaking: tinted primary background plus an inline red
    // pulsing dot beside the label until first activated. The dot also
    // replaces the busy orb for this kind — a side-car is always "running",
    // so the orb carried no signal.
    const isHotTui = tab.kind === 'tui' && !seenTuiIds.has(tab.id);
    const colors =
      tab.kind === 'tui'
        ? tab.id === activeTabId
          ? 'border-primary bg-primary/20 text-primary'
          : 'border-transparent bg-primary/10 text-primary/80 hover:text-primary hover:bg-primary/15'
        : tab.id === activeTabId
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground';
    return (
      <div
        key={tab.id}
        className={`group/tab relative flex items-center justify-center min-w-12 px-3 h-full border-b-2 cursor-pointer transition-colors flex-shrink-0 select-none drawer-tab-in ${colors}`}
        onClick={() => handleSelectTab(tab.id)}
      >
        <span className="flex items-center gap-1">
          {tab.kind === 'service' && (
            <ScrollText size={11} strokeWidth={1.8} className="opacity-80" />
          )}
          <span className="text-[11px] font-medium">{tab.label}</span>
          {isHotTui && (
            <span className="relative top-px ml-1 w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.6)] status-pulse" />
          )}
          {tab.kind !== 'tui' && livePtyIds.has(tab.id) && (
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)] status-pulse" />
          )}
        </span>
        {tabs.length > 1 && (
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded hidden group-hover/tab:flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              handleCloseTab(tab.id);
            }}
            aria-label={`Close terminal ${tab.label}`}
          >
            <X size={10} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  }

  const hasUnseenTui = tabs.some((t) => t.kind === 'tui' && !seenTuiIds.has(t.id));
  const activeTabIsTui = activeKind === 'tui';

  return (
    <div className="h-full flex flex-col">
      {collapsed ? (
        <button
          onClick={onExpand}
          className={`h-full w-full flex items-center gap-2 px-4 transition-colors border-t border-white/[0.08] ${
            hasUnseenTui
              ? 'bg-primary/10 text-primary hover:bg-primary/15'
              : 'text-foreground/80 hover:text-foreground hover:bg-white/[0.04]'
          }`}
        >
          <Terminal size={12} strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</span>
          {hasUnseenTui && (
            <span className="w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.6)] status-pulse" />
          )}
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <div className="flex items-center h-8 flex-shrink-0 border-t border-white/[0.08] pl-1">
          {tabs.filter((t) => t.kind !== 'tui').map(renderTab)}
          <div className="flex-1" />
          {/* TUI tabs (e.g. ports setup) sit right-aligned and tinted so they read
              as Dash speaking, not another terminal. */}
          {tabs.filter((t) => t.kind === 'tui').map(renderTab)}
          <Tooltip content="New terminal">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
              onClick={handleAddTab}
              aria-label="Add terminal"
            >
              <Plus size={11} strokeWidth={2} />
            </button>
          </Tooltip>
          <button
            onClick={onCollapse}
            className="p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        </div>
      )}
      {/* Terminal container always in DOM to avoid re-attach on expand.
          TUI tabs render on a fixed-size xterm canvas — center it so the
          pinned 80-col frame reads as a dialog, not mispadded output. */}
      <div
        ref={containerRef}
        className={`terminal-container terminal-drawer flex-1 min-h-0 ${
          activeTabIsTui ? 'tui-canvas-host' : ''
        }`}
        style={collapsed ? { height: 0, overflow: 'hidden' } : undefined}
      />
    </div>
  );
}
