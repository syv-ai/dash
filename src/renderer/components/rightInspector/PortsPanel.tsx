import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { TaskPort, PortLiveness } from '../../../shared/types';
import { Tooltip } from '../ui/Tooltip';

interface PortsPanelProps {
  ports: TaskPort[];
  liveness: Record<number, PortLiveness>;
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

export function PortsPanel({ ports, liveness }: PortsPanelProps) {
  return (
    <ul className="flex flex-col gap-0.5 px-2 py-1.5">
      {ports.map((port) => (
        <PortRow key={port.id} port={port} state={liveness[port.hostPort] ?? 'unknown'} />
      ))}
    </ul>
  );
}

function PortRow({ port, state }: { port: TaskPort; state: PortLiveness }) {
  const url = `http://localhost:${port.hostPort}`;
  const tooltip = `${port.label} · ${SOURCE_LABEL[port.source]}${
    port.envVar ? ` · $${port.envVar}` : ''
  } · ${state === 'up' ? 'listening' : state === 'down' ? 'not listening' : 'checking…'}`;

  return (
    <li className="group/row flex items-center gap-1.5 px-1.5 py-[3px] rounded hover:bg-accent">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATE_DOT_CLASS[state]}`} aria-hidden />
      <Tooltip content={tooltip}>
        <button
          type="button"
          onClick={() => window.electronAPI.portsOpenUrl(port.hostPort)}
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
      <Tooltip content="Open in browser">
        <button
          type="button"
          onClick={() => window.electronAPI.portsOpenUrl(port.hostPort)}
          className="p-[2px] rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-colors"
        >
          <ExternalLink size={10} strokeWidth={2} />
        </button>
      </Tooltip>
    </li>
  );
}
