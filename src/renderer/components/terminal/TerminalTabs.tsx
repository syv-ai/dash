import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, ChevronsRight, X, Plus } from 'lucide-react';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { Tooltip } from '../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/DropdownMenu';
import { nextShellLabel } from '../../utils/shellTabLabel';
import type { Tab } from '../../../shared/drawerTabs';

/** Px reserved for the `» N` overflow chip when tabs don't all fit. */
const OVERFLOW_TRIGGER_PX = 32;
/** Fallback width for a tab whose real width hasn't been measured yet. */
const TAB_WIDTH_ESTIMATE_PX = 56;

/**
 * Split the tab strip into a visible prefix + an overflow set so the visible
 * tabs fit `trackWidth`. The active tab is always kept visible (never
 * overflowed); other tabs fill the remaining budget left-to-right and the rest
 * collapse into the `» N` dropdown. Pure — measured widths come in via `widths`.
 */
function computeTabLayout(
  tabs: Tab[],
  activeTabId: string | null,
  trackWidth: number,
  widths: Map<string, number>,
): { visibleTabs: Tab[]; overflowTabs: Tab[] } {
  const widthOf = (t: Tab) => widths.get(t.id) ?? TAB_WIDTH_ESTIMATE_PX;
  // Not measured yet, or everything fits → show all, no dropdown.
  if (trackWidth <= 0) return { visibleTabs: tabs, overflowTabs: [] };
  const total = tabs.reduce((sum, t) => sum + widthOf(t), 0);
  if (total <= trackWidth) return { visibleTabs: tabs, overflowTabs: [] };

  // Overflow exists — reserve the chip, pin the active tab, fill the rest.
  const budget = trackWidth - OVERFLOW_TRIGGER_PX;
  const active = tabs.find((t) => t.id === activeTabId);
  const fitted = new Set<string>();
  let used = 0;
  if (active) {
    fitted.add(active.id);
    used += widthOf(active);
  }
  for (const t of tabs) {
    if (fitted.has(t.id)) continue;
    const w = widthOf(t);
    if (used + w > budget) break; // contiguous prefix; stop at first that overflows
    used += w;
    fitted.add(t.id);
  }
  return {
    visibleTabs: tabs.filter((t) => fitted.has(t.id)),
    overflowTabs: tabs.filter((t) => !fitted.has(t.id)),
  };
}

interface TerminalTabsProps {
  taskId: string;
  cwd: string;
  collapsed: boolean;
  label?: string;
  onCollapse: () => void;
  onExpand: () => void;
}

export function TerminalTabs({
  taskId,
  cwd,
  collapsed,
  label = 'Terminal',
  onCollapse,
  onExpand,
}: TerminalTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shellId = `shell:${taskId}`;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [livePtyIds, setLivePtyIds] = useState<Set<string>>(new Set());
  const pendingFocusRef = useRef<string | null>(null);
  // Tab-overflow: measured tab widths (by id) + the available track width drive
  // the split into a visible prefix and a `» N` dropdown. A hidden row lays out
  // every tab off-screen so even tabs currently in the dropdown have a real
  // measured width (an estimate would over- or under-fill the bar).
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const tabWidthsRef = useRef<Map<string, number>>(new Map());
  const [trackWidth, setTrackWidth] = useState(0);
  const [, setWidthsVersion] = useState(0);

  // Subscribe to main's drawer-tabs feed. On first mount of a task that has no
  // rows yet, seed the default shell tab so we don't render an empty header.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const [listResp, activeResp, liveResp] = await Promise.all([
        window.electronAPI.drawerTabsList(taskId),
        window.electronAPI.drawerTabsGetActive(taskId),
        window.electronAPI.ptyListForTask(taskId, { kinds: ['service'] }),
      ]);
      if (cancelled) return;
      if (listResp.success && listResp.data) setTabs(listResp.data);
      if (activeResp.success) setActiveTabId(activeResp.data ?? null);
      if (liveResp.success && liveResp.data) setLivePtyIds(new Set(liveResp.data));
    };

    void refresh();
    void window.electronAPI.drawerTabsSubscribe(taskId);
    const off = window.electronAPI.onDrawerTabsChanged((changedTaskId) => {
      if (changedTaskId === taskId) void refresh();
    });
    // An add-on's state change (e.g. a service started or stopped) can flip a
    // service tab's live dot without touching the tab rows.
    const offAddons = window.electronAPI.onAddonsChanged(() => void refresh());

    // Seed the first shell tab if the task has no shell tabs yet. Checked by
    // kind, not list length — a service tab racing in first must not starve
    // the task of its shell. Idempotent — once the row lands in SQLite, this
    // branch never fires again.
    void (async () => {
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
      offAddons();
      void window.electronAPI.drawerTabsUnsubscribe(taskId);
    };
  }, [taskId, shellId]);

  // A main-spawned service PTY dying on its own pushes no tab change — drop
  // its dot the moment its exit reaches the renderer.
  useEffect(() => {
    const offs = tabs
      .filter((t) => t.kind === 'service')
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

  // Attach the active tab's session to the container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeTabId) return;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const activeTab = tabs.find((t) => t.id === activeTabId);
    // Service tabs attach to a PTY main spawned (never self-spawn a shell), and
    // their output won't redraw on reattach, so the snapshot replays.
    const isTui = activeTab?.kind === 'service';

    const session = sessionRegistry.getOrCreate({
      id: activeTabId,
      cwd,
      shellOnly: true,
      isTui,
    });
    const autoFocus = pendingFocusRef.current === activeTabId;
    if (autoFocus) pendingFocusRef.current = null;
    void session.attach(container, { autoFocus });

    return () => {
      void sessionRegistry.detach(activeTabId);
    };
  }, [activeTabId, cwd, tabs]);

  // An add-on terminal (re)started or asked for: main asks us to surface it.
  useEffect(() => {
    const focus = ({
      taskId: tid,
      tabId,
      reset,
    }: {
      taskId: string;
      tabId: string;
      reset: boolean;
    }) => {
      if (tid !== taskId) return;
      onExpand();
      // reset: main respawned this service's PTY under the same id. The cached
      // session is still bound to the dead process — re-link it (without
      // killing the new PTY, which dispose() would) so the fresh run's output
      // actually shows.
      if (reset) {
        const session = sessionRegistry.get(tabId);
        if (session) void session.resetForRespawn();
      }
      void window.electronAPI.drawerTabsSetActive(taskId, tabId);
    };
    return window.electronAPI.onAddonsFocusTab(focus);
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
    void window.electronAPI.drawerTabsSetActive(taskId, id);
  }

  function handleCloseTab(tabId: string) {
    if (tabs.length <= 1) return;
    const tab = tabs.find((t) => t.id === tabId);
    void sessionRegistry.dispose(tabId);
    void window.electronAPI.drawerTabsClose(tabId);
    // Closing a service tab kills its PTY (dispose → ptyKill), which no exit
    // hook reports; tell the owning add-on so its drawer stops offering "Stop".
    if (tab?.kind === 'service') void window.electronAPI.addonsTerminalClosed({ taskId, tabId });
  }

  function handleSelectTab(tabId: string) {
    void window.electronAPI.drawerTabsSetActive(taskId, tabId);
  }

  // Track the available width of the tab strip; re-attach the observer when the
  // drawer expands (the track only exists in the expanded branch).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => setTrackWidth(track.clientWidth));
    ro.observe(track);
    setTrackWidth(track.clientWidth);
    return () => ro.disconnect();
  }, [collapsed]);

  // Measure every tab from the hidden row (before paint) and cache its width.
  // Bump the version only when a width actually changed, so this can't loop.
  // Re-runs when the tab set or live-dot state changes — the inputs that affect
  // a tab's rendered width.
  useLayoutEffect(() => {
    const row = measureRef.current;
    if (!row) return;
    let changed = false;
    row.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((el) => {
      const id = el.dataset.tabId;
      if (!id) return;
      const w = el.offsetWidth;
      if (w > 0 && tabWidthsRef.current.get(id) !== w) {
        tabWidthsRef.current.set(id, w);
        changed = true;
      }
    });
    if (changed) setWidthsVersion((v) => v + 1);
  }, [tabs, livePtyIds]);

  function renderTab(tab: Tab) {
    const isActive = tab.id === activeTabId;
    // No underline. The active (focused) tab — shell or service alike — wears
    // the port-terminal periwinkle wash as a full-height fill. Inactive tabs
    // keep a per-kind look so a service tab still reads differently from a
    // plain shell at rest.
    const colors = isActive
      ? 'bg-[hsl(var(--terminal-service)/0.16)] text-foreground'
      : tab.kind === 'service'
        ? 'bg-[hsl(var(--terminal-service)/0.06)] text-fg-fade-60 hover:text-foreground hover:bg-[hsl(var(--terminal-service)/0.11)]'
        : 'text-muted-foreground hover:text-foreground';
    const closeable = tabs.length > 1;
    const showDot = livePtyIds.has(tab.id);
    const dotColor = 'bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)]';
    return (
      <div
        key={tab.id}
        data-tab-id={tab.id}
        className={`group/tab relative flex items-center justify-center min-w-11 px-2.5 h-full cursor-pointer transition-colors shrink-0 select-none drawer-tab-in ${colors}`}
        onClick={() => handleSelectTab(tab.id)}
      >
        {/* The label and its activity dot are centered content together — the
            dot is on equal footing with the text, not tucked into the gutter.
            Only the transient close button floats absolutely in the right
            gutter so it never shifts the centered content off-center. */}
        <span className="flex items-center gap-1">
          <span className="text-[11px] font-medium">{tab.label}</span>
          {showDot && (
            // A running service is a steady state — solid green, not a pulsing
            // attention-grab. Shells keep the pulse. On hover the close button
            // takes over, so hide the dot with `invisible` (keeps its layout
            // slot — no recenter jitter — and beats the pulse opacity animation,
            // which a plain opacity utility would lose to).
            <span
              className={`w-1.5 h-1.5 rounded-full ${dotColor} ${
                tab.kind === 'service' ? '' : 'status-pulse'
              } ${closeable ? 'group-hover/tab:invisible' : ''}`}
            />
          )}
        </span>
        {closeable && (
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded hidden group-hover/tab:flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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

  const hasLiveService = tabs.some((t) => t.kind === 'service' && livePtyIds.has(t.id));
  const { visibleTabs, overflowTabs } = computeTabLayout(
    tabs,
    activeTabId,
    trackWidth,
    tabWidthsRef.current,
  );

  return (
    <div className="h-full flex flex-col">
      {collapsed ? (
        <button
          onClick={onExpand}
          className="h-full w-full flex items-center gap-2 px-4 transition-colors border-t border-edge/8 text-fg-fade-80 hover:text-foreground hover:bg-edge/4"
        >
          <Terminal size={12} strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</span>
          {hasLiveService && (
            // A running service is a steady state — solid green, no pulse.
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)]" />
          )}
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <div className="relative flex items-center h-7 shrink-0 border-t border-edge/8 pl-1">
          {/* Hidden measuring row — lays out every shell/service tab off-screen
              so the overflow split below uses real measured widths even for tabs
              currently collapsed into the dropdown. */}
          <div
            ref={measureRef}
            aria-hidden
            className="absolute left-0 top-0 flex items-center h-full opacity-0 pointer-events-none"
          >
            {tabs.map(renderTab)}
          </div>
          {/* Tabs that fit render in the track; the rest collapse into a `» N`
              dropdown so the trailing +/collapse controls stay reachable when
              the panel is narrow. The active tab is always kept visible. */}
          {/* h-full so each tab's h-full fill spans the strip top-to-bottom
              (the wrapper would otherwise collapse to content height, leaving
              the service-tab wash as a short pill). */}
          <div ref={trackRef} className="flex items-center h-full flex-1 min-w-0 overflow-hidden">
            {visibleTabs.map(renderTab)}
            {overflowTabs.length > 0 && (
              <DropdownMenu>
                <Tooltip
                  content={`${overflowTabs.length} more terminal${overflowTabs.length > 1 ? 's' : ''}`}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center h-full px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                      aria-label={`${overflowTabs.length} more terminals`}
                    >
                      <ChevronsRight size={12} strokeWidth={2} />
                      <span className="tabular-nums">{overflowTabs.length}</span>
                    </button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" sideOffset={6}>
                  {overflowTabs.map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => handleSelectTab(t.id)}>
                      <span className="flex-1 text-[13px]">{t.label}</span>
                      {livePtyIds.has(t.id) && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--git-added))]" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <Tooltip content="New terminal">
            <button
              onClick={() => void handleAddTab()}
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              aria-label="New terminal"
            >
              <Plus size={11} strokeWidth={2} />
            </button>
          </Tooltip>
          <button
            onClick={onCollapse}
            className="p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        </div>
      )}
      {/* Terminal container always in DOM to avoid re-attach on expand. */}
      <div
        ref={containerRef}
        className={`terminal-container terminal-drawer flex-1 min-h-0 ${collapsed ? '' : 'px-2 pb-1.5'}`}
        style={collapsed ? { height: 0, overflow: 'hidden' } : undefined}
      />
    </div>
  );
}
