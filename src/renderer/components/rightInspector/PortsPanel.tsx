import React, { useState } from 'react';
import { ExternalLink, Play, Square, ScrollText, Loader2 } from 'lucide-react';
import type { TaskPort, PortLiveness } from '../../../shared/types';
import { Tooltip } from '../ui/Tooltip';

interface PortsPanelProps {
  taskId: string;
  ports: TaskPort[];
  liveness: Record<number, PortLiveness>;
  serviceStates: Record<string, { ownedTabId: string | null }>;
}

const SOURCE_LABEL: Record<TaskPort['source'], string> = {
  fixed: 'Fixed port from .dash/ports.json',
  hash: 'Auto-allocated (deterministic hash)',
  override: 'Pinned via .dash/ports.local.json',
  probe: 'Auto-allocated (probed past collision)',
};

const STATE_DOT_CLASS: Record<PortLiveness, string> = {
  up: 'bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)]',
  down: 'bg-foreground/25',
  unknown: 'bg-foreground/40 animate-pulse',
};

export function PortsPanel({ taskId, ports, liveness, serviceStates }: PortsPanelProps) {
  return (
    <ul className="flex flex-col gap-0.5 pl-2 pr-1 py-1.5">
      {ports.map((port) => (
        <PortRow
          key={port.id}
          taskId={taskId}
          port={port}
          state={liveness[port.hostPort] ?? 'unknown'}
          owned={Boolean(serviceStates[port.label]?.ownedTabId)}
        />
      ))}
    </ul>
  );
}

function PortRow({
  taskId,
  port,
  state,
  owned,
}: {
  taskId: string;
  port: TaskPort;
  state: PortLiveness;
  owned: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // `owned` (Dash spawned this service and its PTY is alive) is authoritative —
  // a running service shows as up and offers Stop even before the liveness
  // probe confirms the port is listening (it may bind late, or on a port the
  // project didn't wire to the allocated one).
  const running = owned || state === 'up';
  const showStop = running;
  const showRun = !running && Boolean(port.runCommand);
  const showLogs = owned || Boolean(port.logsCommand);

  const runStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (showStop) await window.electronAPI.portsServiceStop(taskId, port);
      else await window.electronAPI.portsServiceStart(taskId, port);
    } finally {
      setBusy(false);
    }
  };

  const dotClass = running
    ? STATE_DOT_CLASS.up
    : state === 'unknown'
      ? STATE_DOT_CLASS.unknown
      : STATE_DOT_CLASS.down;
  const statusText =
    state === 'up'
      ? 'listening'
      : owned
        ? 'running'
        : state === 'down'
          ? 'not listening'
          : 'checking…';
  const url = `http://localhost:${port.hostPort}`;
  const tooltip = `${port.label} · ${SOURCE_LABEL[port.source]}${
    port.envVar ? ` · $${port.envVar}` : ''
  } · ${statusText}`;

  return (
    <li className="group/row flex items-center gap-1.5 pl-1.5 pr-0.5 py-1.5 rounded hover:bg-accent">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} aria-hidden />
      <Tooltip content={tooltip}>
        <button
          type="button"
          onClick={() => {
            void window.electronAPI.portsOpenUrl(port.hostPort);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            void window.electronAPI.clipboardWriteText(e.shiftKey ? String(port.hostPort) : url);
          }}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
        >
          <span className="text-[11.5px] text-foreground truncate min-w-0 flex-1">
            {port.label}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums shrink-0">
            :{port.hostPort}
          </span>
        </button>
      </Tooltip>
      {(showRun || showStop) && (
        <Tooltip content={showStop ? `Stop ${port.label}` : `Run: ${port.runCommand}`}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void runStop();
            }}
            className={`p-[2px] rounded text-muted-foreground/40 hover:bg-accent/60 transition-colors disabled:opacity-40 ${
              showStop ? 'hover:text-destructive' : 'hover:text-foreground'
            }`}
          >
            {busy ? (
              <Loader2 size={10} strokeWidth={2} className="animate-spin" />
            ) : showStop ? (
              <Square size={10} strokeWidth={2} />
            ) : (
              <Play size={10} strokeWidth={2} />
            )}
          </button>
        </Tooltip>
      )}
      {showLogs && (
        <Tooltip content={owned ? 'Show service terminal' : `Logs: ${port.logsCommand}`}>
          <button
            type="button"
            onClick={() => {
              void window.electronAPI.portsServiceLogs(taskId, port);
            }}
            className="p-[2px] rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-colors"
          >
            <ScrollText size={10} strokeWidth={2} />
          </button>
        </Tooltip>
      )}
      <Tooltip content="Open in browser">
        <button
          type="button"
          onClick={() => {
            void window.electronAPI.portsOpenUrl(port.hostPort);
          }}
          className="p-[2px] rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-colors"
        >
          <ExternalLink size={10} strokeWidth={2} />
        </button>
      </Tooltip>
    </li>
  );
}
