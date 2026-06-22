import React, { useRef, useEffect, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, X, Plus, Check } from 'lucide-react';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { Tooltip } from '../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu';
import { nextShellLabel } from '../../utils/shellTabLabel';
import { useProjects } from '../../stores/projectsStore';
import { WIZARDS } from '../../../shared/wizards';
import { type TuiFeatureId } from '../../../shared/tuiProtocol';
import type { Tab } from '../../../shared/drawerTabs';

/** Minimum drawer height (px) for a side-car TUI's CTA start screen. */
const MIN_TUI_DRAWER_PX = 300;
/** Rough canvas px (52 cols × ~8px) if the real measurement never lands. */
const TUI_COLS_FALLBACK_PX = 420;

interface TerminalTabsProps {
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

export function TerminalTabs({
  taskId,
  cwd,
  collapsed,
  label = 'Terminal',
  onCollapse,
  onExpand,
  onEnsureHeight,
  onTuiActiveChange,
}: TerminalTabsProps) {
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

    void refresh();
    void window.electronAPI.drawerTabsSubscribe(taskId);
    const off = window.electronAPI.onDrawerTabsChanged((changedTaskId) => {
      if (changedTaskId === taskId) void refresh();
    });
    const offService = window.electronAPI.onPortsServiceChanged(({ taskId: tid }) => {
      if (tid === taskId) void refresh();
    });

    // Seed the first shell tab if the task has no shell tabs yet. Checked by
    // kind, not list length — a TUI tab racing in first (fresh task spawning
    // its onboarding CTA) must not starve the task of its shell. Idempotent —
    // once the row lands in SQLite, this branch never fires again.
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
      offService();
      void window.electronAPI.drawerTabsUnsubscribe(taskId);
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
    void session.attach(container, { autoFocus });

    return () => {
      void sessionRegistry.detach(activeTabId);
    };
  }, [activeTabId, cwd, tabs]);

  // Logs button with a Dash-owned tab: main asks us to surface that tab.
  useEffect(() => {
    const off = window.electronAPI.onPortsServiceFocusTab(({ taskId: tid, tabId, reset }) => {
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

  // Which wizards have already produced their artifact (e.g. ports setup wrote
  // .dash/ports.json) — drives the green checkmark. Refreshed when the dropdown
  // opens so it reflects the latest on-disk state.
  const [wizardDone, setWizardDone] = useState<Record<string, boolean>>({});

  async function refreshWizardDone() {
    const entries = await Promise.all(
      WIZARDS.map(async (w) => {
        const r = await window.electronAPI.wizardCompleted({ featureId: w.id, cwd });
        return [w.id, r.success ? Boolean(r.data) : false] as const;
      }),
    );
    setWizardDone(Object.fromEntries(entries));
  }

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

  async function handleLaunchWizard(featureId: TuiFeatureId) {
    const { projects, tasksByProject } = useProjects.getState();
    const task = Object.values(tasksByProject)
      .flat()
      .find((t) => t.id === taskId);
    const project = task && projects.find((p) => p.id === task.projectId);
    if (!task || !project) return;
    // force: the user explicitly picked the wizard, so re-run it even when it's
    // already dismissed or finished this session. The wizard surfaces as a
    // persistent toast (no drawer tab).
    void window.electronAPI.requestWizard({
      featureId,
      taskId,
      projectId: task.projectId,
      taskName: task.name,
      projectName: project.name,
      cwd,
      force: true,
    });
  }

  function handleCloseTab(tabId: string) {
    if (tabs.length <= 1) return;
    const tab = tabs.find((t) => t.id === tabId);
    void sessionRegistry.dispose(tabId);
    void window.electronAPI.drawerTabsClose(tabId);
    // Closing a service run tab kills its PTY (dispose → ptyKill); that bypasses
    // ServiceRunner, so tell it to release ownership and refresh the ports panel
    // — otherwise the row keeps offering a dead "Stop".
    if (tab?.kind === 'service') {
      void window.electronAPI.portsServiceReleaseTab(taskId, tabId);
    }
  }

  function handleSelectTab(tabId: string) {
    void window.electronAPI.drawerTabsSetActive(taskId, tabId);
  }

  function renderTab(tab: Tab) {
    // TUI tabs are Dash speaking: tinted primary background plus an inline red
    // pulsing dot beside the label until first activated. The dot also
    // replaces the busy orb for this kind — a side-car is always "running",
    // so the orb carried no signal.
    const isHotTui = tab.kind === 'tui' && !seenTuiIds.has(tab.id);
    const isActive = tab.id === activeTabId;
    // No underline. The active (focused) tab — shell or service alike — wears
    // the port-terminal periwinkle wash as a full-height fill. Inactive tabs
    // keep a per-kind look so a service tab still reads differently from a
    // plain shell at rest. Wizard TUIs stay in their own primary tint.
    const colors =
      tab.kind === 'tui'
        ? isActive
          ? 'bg-primary/20 text-primary'
          : 'bg-primary/10 text-primary/80 hover:text-primary hover:bg-primary/15'
        : isActive
          ? 'bg-[hsl(var(--terminal-service)/0.16)] text-foreground'
          : tab.kind === 'service'
            ? 'bg-[hsl(var(--terminal-service)/0.06)] text-foreground/60 hover:text-foreground hover:bg-[hsl(var(--terminal-service)/0.11)]'
            : 'text-muted-foreground hover:text-foreground';
    const closeable = tabs.length > 1;
    const showDot = isHotTui || (tab.kind !== 'tui' && livePtyIds.has(tab.id));
    // Hot wizard = red; live shell/service = green.
    const dotColor = isHotTui
      ? 'bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.6)]'
      : 'bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)]';
    return (
      <div
        key={tab.id}
        className={`group/tab relative flex items-center justify-center min-w-12 px-3 h-full cursor-pointer transition-colors flex-shrink-0 select-none drawer-tab-in ${colors}`}
        onClick={() => handleSelectTab(tab.id)}
      >
        <span className="flex items-center gap-1">
          <span className="text-[11px] font-medium">{tab.label}</span>
          {(showDot || closeable) && (
            // The status dot and the close button share one trailing slot, so on
            // hover the "x" lands directly over the pulsing dot rather than beside
            // it. The dot animates its own opacity (pulse-glow), so it's toggled
            // off with `hidden` — an opacity utility would lose to the animation.
            <span className="relative ml-0.5 inline-flex w-1.5 h-1.5">
              {showDot && (
                // A running service is a steady state — solid green, not a
                // pulsing attention-grab. Shells keep the pulse.
                <span
                  className={`absolute inset-0 rounded-full ${dotColor} ${
                    tab.kind === 'service' ? '' : 'status-pulse'
                  } ${closeable ? 'group-hover/tab:hidden' : ''}`}
                />
              )}
              {closeable && (
                <button
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded hidden group-hover/tab:flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  aria-label={`Close terminal ${tab.label}`}
                >
                  <X size={10} strokeWidth={2} />
                </button>
              )}
            </span>
          )}
        </span>
      </div>
    );
  }

  const hasUnseenTui = tabs.some((t) => t.kind === 'tui' && !seenTuiIds.has(t.id));
  const hasLiveService = tabs.some((t) => t.kind === 'service' && livePtyIds.has(t.id));
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
          {hasUnseenTui ? (
            <span className="w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.6)] status-pulse" />
          ) : (
            hasLiveService && (
              // A running service is a steady state — solid green, no pulse.
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)]" />
            )
          )}
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <div className="flex items-center h-10 flex-shrink-0 border-t border-white/[0.08] pl-1">
          {/* Tab strip scrolls within its own track so the trailing +/collapse
              controls stay reachable when the panel is narrow or tabs are many. */}
          {/* h-full so each tab's h-full fill spans the strip top-to-bottom
              (the wrapper would otherwise collapse to content height, leaving
              the service-tab wash as a short pill). */}
          <div className="flex items-center h-full flex-1 min-w-0 overflow-x-auto scrollbar-none">
            {tabs.filter((t) => t.kind !== 'tui').map(renderTab)}
          </div>
          {/* TUI tabs (e.g. ports setup) sit right-aligned and tinted so they read
              as Dash speaking, not another terminal. */}
          {tabs.filter((t) => t.kind === 'tui').map(renderTab)}
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) void refreshWizardDone();
            }}
          >
            <Tooltip content="New terminal or wizard">
              <DropdownMenuTrigger asChild>
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                  aria-label="New terminal or wizard"
                >
                  <Plus size={11} strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem onSelect={() => void handleAddTab()}>
                <Terminal size={13} strokeWidth={1.8} />
                <span className="text-[13px]">Terminal</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Wizards</DropdownMenuLabel>
                {WIZARDS.map((w) => (
                  <DropdownMenuItem key={w.id} onSelect={() => void handleLaunchWizard(w.id)}>
                    <span className="flex-1 text-[13px]">{w.label}</span>
                    {wizardDone[w.id] && (
                      <Check size={13} strokeWidth={2} className="text-[hsl(var(--git-added))]" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
        } ${collapsed ? '' : 'px-2 pb-2'}`}
        style={collapsed ? { height: 0, overflow: 'hidden' } : undefined}
      />
    </div>
  );
}
