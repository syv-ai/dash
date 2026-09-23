import {
  button,
  iconAction,
  list,
  progress,
  row,
  text,
  type Block,
  type Drawer,
  type IconAction,
  type RowBlock,
} from '@shared/addon-api';
import type { HeuristicResult } from './PortsHeuristic';
import type { Setup } from './setup';
import type { PortLiveness, TaskPort } from './types';

const SOURCE_LABEL: Record<TaskPort['source'], string> = {
  fixed: 'Fixed port from .dash/ports.json',
  hash: 'Auto-allocated (deterministic hash)',
  override: 'Pinned via .dash/ports.local.json',
  probe: 'Auto-allocated (probed past collision)',
};

export interface DrawerInput {
  /** The worktree has `.dash/ports.json`. */
  configured: boolean;
  heuristic: Pick<HeuristicResult, 'signals' | 'guesses'>;
  setup: Setup | null;
  /** Name of the setup task, when `setup` is `started`. */
  setupTaskName?: string;
  ports: TaskPort[];
  liveness: Record<number, PortLiveness>;
  /** Labels whose run terminal Dash owns and is alive. */
  owned: Set<string>;
}

/** The Ports drawer for one task: setup progress, the setup offer, or the ports list. */
export function buildDrawer(input: DrawerInput): Drawer {
  if (input.setup) return { title: 'Ports', blocks: setupBlocks(input.setup, input.setupTaskName) };
  if (!input.configured) return { title: 'Ports', blocks: offerBlocks(input.heuristic) };
  return portsDrawer(input);
}

function setupBlocks(s: Setup, setupTaskName?: string): Block[] {
  switch (s.kind) {
    case 'creating':
      return [progress({ label: 'Creating the port-setup task…' })];
    case 'started':
      return [
        text(`Setup is running in task ${setupTaskName ?? 'port-setup'}.`),
        button('open-setup', 'Open task', { primary: true }),
        button('dismiss', 'Hide'),
      ];
    case 'create-failed':
      return [
        text(`Couldn't create the port-setup task: ${s.message}`, 'error'),
        button('start', 'Try again', { primary: true }),
        button('dismiss', 'Hide'),
      ];
    case 'waiting':
      return [
        progress({ label: 'Waiting for the agent to write .dash/ports.json' }),
        ...(s.errors ?? []).map((e) => text(e, 'error')),
      ];
    case 'allocated':
      return [
        text(`Allocated ${s.count} port${s.count === 1 ? '' : 's'}.`, 'success'),
        text('Restart the sessions so they get the new port variables.', 'muted'),
        button('restart', 'Restart sessions', { primary: true }),
        button('dismiss', 'Later'),
      ];
    case 'timed-out':
      return [
        text("The agent didn't write .dash/ports.json within 30 minutes.", 'error'),
        button('dismiss', 'Hide'),
      ];
  }
}

function offerBlocks(h: DrawerInput['heuristic']): Block[] {
  const blocks: Block[] = [];
  if (h.signals.length > 0 || h.guesses.length > 0) {
    blocks.push(text('This project looks like it runs services on local ports.'));
    if (h.signals.length > 0) blocks.push(text(`Detected: ${h.signals.join(', ')}`, 'muted'));
    if (h.guesses.length > 0) {
      blocks.push(
        text(
          `Likely services: ${h.guesses.map((g) => `${g.label} (${g.envVar} @ ${g.defaultPort})`).join(', ')}`,
          'muted',
        ),
      );
    }
  } else {
    blocks.push(
      text(
        'Port management gives each task its own ports, so services in different worktrees never collide.',
      ),
    );
  }
  blocks.push(
    text(
      'Setup opens a port-setup task where Claude writes .dash/ports.json for this project.',
      'muted',
    ),
  );
  blocks.push(button('start', 'Start setup', { primary: true }));
  return blocks;
}

function portsDrawer(input: DrawerInput): Drawer {
  const { ports, liveness, owned } = input;
  const up = ports.filter((p) => liveness[p.hostPort] === 'up').length;
  const isRunning = (p: TaskPort) => owned.has(p.label) || liveness[p.hostPort] === 'up';
  const runnable = ports.filter((p) => p.runCommand);

  const actions: IconAction[] = [];
  if (runnable.some((p) => !isRunning(p))) {
    actions.push(iconAction('run-all', 'play', 'Run all services'));
  }
  if (ports.some(isRunning) && runnable.length > 0) {
    actions.push(iconAction('stop-all', 'square', 'Stop all services'));
  }
  actions.push(iconAction('refresh', 'refresh-cw', 'Re-allocate from .dash/ports.json'));

  if (ports.length === 0) {
    return {
      title: 'Ports',
      actions,
      blocks: [text('.dash/ports.json declares no ports.', 'muted')],
    };
  }

  return {
    title: 'Ports',
    summary: `${up}/${ports.length} up`,
    actions,
    blocks: [
      list(ports.map((p) => portRow(p, liveness[p.hostPort] ?? 'unknown', owned.has(p.label)))),
    ],
  };
}

function portRow(p: TaskPort, state: PortLiveness, isOwned: boolean): RowBlock {
  // `owned` (Dash runs it and its terminal is alive) is authoritative: a running
  // service shows as up and offers Stop before the probe sees it listening.
  const running = isOwned || state === 'up';
  const status = running ? 'up' : state === 'unknown' ? 'unknown' : 'down';
  const statusText =
    state === 'up'
      ? 'listening'
      : isOwned
        ? 'running'
        : state === 'down'
          ? 'not listening'
          : 'checking…';

  const actions: IconAction[] = [];
  if (running) actions.push(iconAction(`stop:${p.label}`, 'square', `Stop ${p.label}`));
  else if (p.runCommand) actions.push(iconAction(`run:${p.label}`, 'play', `Run: ${p.runCommand}`));
  if (isOwned || p.logsCommand) {
    actions.push(
      iconAction(
        `logs:${p.label}`,
        'scroll-text',
        isOwned ? 'Show service terminal' : `Logs: ${p.logsCommand}`,
      ),
    );
  }
  actions.push(iconAction(`open:${p.label}`, 'external-link', 'Open in browser'));

  return row(p.label, {
    meta: `:${p.hostPort}`,
    status,
    tooltip: `${p.label} · ${SOURCE_LABEL[p.source]}${p.envVar ? ` · $${p.envVar}` : ''} · ${statusText}`,
    onClick: `open:${p.label}`,
    actions,
  });
}
