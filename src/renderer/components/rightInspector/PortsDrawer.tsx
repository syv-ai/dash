import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Plug, RefreshCw, Play, Loader2 } from 'lucide-react';
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

const LABEL = 'PORTS';

export function PortsDrawer({ taskId, state, collapsed, onCollapse, onExpand }: PortsDrawerProps) {
  const status = `${state.livenessSummary.up}/${state.livenessSummary.total} up`;
  const [startingAll, setStartingAll] = useState(false);

  const runAll = () => {
    if (startingAll) return;
    setStartingAll(true);
    void window.electronAPI.portsServiceStartAll(taskId).finally(() => setStartingAll(false));
  };

  return (
    <div className="flex flex-col flex-shrink-0 ports-drawer-enter">
      {collapsed ? (
        <button
          onClick={onExpand}
          className="h-7 w-full flex items-center gap-2 px-4 text-foreground/80 hover:text-foreground transition-colors border-t border-white/[0.08] hover:bg-white/[0.04]"
        >
          <Plug size={12} strokeWidth={1.8} className="text-foreground/80" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{LABEL}</span>
          <span className="text-[10.5px] tabular-nums text-muted-foreground/80">{status}</span>
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <>
          <div className="ports-header flex items-center h-8 flex-shrink-0 border-t border-white/[0.08]">
            <Plug
              size={12}
              strokeWidth={1.8}
              className="flex-shrink-0 ml-3 mr-1.5 text-foreground/80"
            />
            <span className="ports-label text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
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
          <div className="overflow-y-auto max-h-[50vh]" style={{ scrollbarGutter: 'stable' }}>
            <PortsPanel
              taskId={taskId}
              ports={state.ports}
              liveness={state.liveness}
              serviceStates={state.serviceStates}
            />
          </div>
        </>
      )}
    </div>
  );
}
