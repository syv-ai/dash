import React, { useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Play, Square, Loader2 } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { PortsPanel } from './PortsPanel';
import type { PortsState } from './usePortsState';

interface PortsDrawerProps {
  taskId: string;
  state: PortsState;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}

const LABEL = 'SERVICES';

export function PortsDrawer({ taskId, state, collapsed, onCollapse, onExpand }: PortsDrawerProps) {
  const status = `${state.livenessSummary.up}/${state.livenessSummary.total} up`;
  const [startingAll, setStartingAll] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);

  const runAll = () => {
    if (startingAll) return;
    setStartingAll(true);
    void window.electronAPI.portsServiceStartAll(taskId).finally(() => setStartingAll(false));
  };

  const stopAll = () => {
    if (stoppingAll) return;
    setStoppingAll(true);
    void window.electronAPI.portsServiceStopAll(taskId).finally(() => setStoppingAll(false));
  };

  return (
    <div className="flex flex-col h-full ports-drawer-enter">
      {collapsed ? (
        <button
          onClick={onExpand}
          className="h-full w-full flex items-center gap-2 px-4 text-foreground/80 hover:text-foreground transition-colors border-t border-white/[0.08] hover:bg-white/[0.04]"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{LABEL}</span>
          <span className="text-[10.5px] tabular-nums text-muted-foreground/80">{status}</span>
          {state.anyRunning && (
            // A running service is a steady state — solid green, no pulse.
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)]" />
          )}
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <div className="ports-header flex items-center h-10 flex-shrink-0 border-t border-white/[0.08]">
          <span className="ports-label ml-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
            {LABEL}
          </span>
          <span className="ports-status ml-2 text-[10.5px] tabular-nums text-muted-foreground/80">
            {status}
          </span>
          <div className="flex-1" />
          {state.anyRunnable && (
            <Tooltip content="Run all services">
              <button
                type="button"
                onClick={runAll}
                disabled={state.allRunnableUp || startingAll}
                className="p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-40"
              >
                {startingAll ? (
                  <Loader2 size={11} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Play size={11} strokeWidth={2} />
                )}
              </button>
            </Tooltip>
          )}
          {state.anyRunnable && (
            <Tooltip content="Stop all services">
              <button
                type="button"
                onClick={stopAll}
                disabled={!state.anyRunning || stoppingAll}
                className="p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-40"
              >
                {stoppingAll ? (
                  <Loader2 size={11} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Square size={11} strokeWidth={2} />
                )}
              </button>
            </Tooltip>
          )}
          <Tooltip content="Re-allocate from .dash/ports.json">
            <button
              type="button"
              onClick={() => {
                void state.refresh();
              }}
              disabled={state.refreshing}
              className="p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-40"
            >
              <RefreshCw
                size={11}
                strokeWidth={2}
                className={state.refreshing ? 'animate-spin' : ''}
              />
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
      {/* Scrolling list fills the resizable panel below the header; the panel
          itself governs the section's height (drag to resize, collapse to the
          bar above), matching the terminal drawer. */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <PortsPanel
            taskId={taskId}
            ports={state.ports}
            liveness={state.liveness}
            serviceStates={state.serviceStates}
          />
        </div>
      )}
    </div>
  );
}
