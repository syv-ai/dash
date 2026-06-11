/**
 * Side-car TUI process. Spawned by SidecarTuiHost via startCommandPty as
 * kind='tui'. Connects back to main on the UNIX socket whose path is passed
 * via DASH_TUI_SOCKET; renders the feature selected by DASH_TUI_FEATURE.
 * Pure renderer — no fs, no file watching, no business logic.
 */

// MUST run before any @clack/prompts load — see require() below. Clack samples
// isTTY at import time to pick between an in-place spinner (with cursor-up
// codes) and a non-TTY fallback that re-prints the spinner frame as a new
// line. When this process runs as `ELECTRON_RUN_AS_NODE=1 electron tui.js`,
// Node's TTY detection on the PTY-wrapped stdio doesn't always tag
// stdout/stderr as TTY, so without these flags the user sees the spinner
// cascade line by line. ESM imports would be hoisted above this block, so we
// `require()` Clack lazily after setting the flags. Feature modules may only
// TYPE-import clack for the same reason.
(process.stdout as { isTTY?: boolean }).isTTY = true;
(process.stderr as { isTTY?: boolean }).isTTY = true;
process.stdout.columns ??= 80;
process.stdout.rows ??= 24;

import net from 'net';
import { TUI_PROTOCOL_VERSION } from '../../../shared/tuiProtocol';
import type { ScreenContext, ShowHandler } from './types';
import { showPortsScreen } from './features/ports';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const clack = require('@clack/prompts') as typeof import('@clack/prompts');
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const handlers: Record<string, ShowHandler> = {
  ports: showPortsScreen,
};

const featureId = process.env.DASH_TUI_FEATURE ?? '';
const handleShow = handlers[featureId];
if (!handleShow) {
  console.error(`[tui] unknown feature: "${featureId}"`);
  process.exit(1);
}

const sockPath = process.env.DASH_TUI_SOCKET;
if (!sockPath) {
  console.error('[tui] missing DASH_TUI_SOCKET');
  process.exit(1);
}

const socket = net.createConnection(sockPath);
let buffer = '';

function send(msg: unknown): void {
  socket.write(JSON.stringify(msg) + '\n');
}

socket.on('connect', () => {
  send({ type: 'ready', version: TUI_PROTOCOL_VERSION });
});

socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\n');
  buffer = lines.pop()!;
  for (const line of lines) {
    if (!line) continue;
    try {
      void handle(JSON.parse(line) as { type: string; text?: string });
    } catch (err) {
      send({ type: 'error', message: `bad message: ${(err as Error).message}` });
    }
  }
});

socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));

// Timeout if main never sends `show`
const initialTimeout = setTimeout(() => {
  console.error("[tui] Dash didn't respond within 30s; exiting.");
  process.exit(1);
}, 30_000);

let currentSpinner: ReturnType<typeof clack.spinner> | null = null;
let currentSpinnerLabel: string | null = null;

function stopCurrentSpinner(): void {
  if (!currentSpinner) return;
  // Pass the current label so the stopped row renders as "◇ <label>" rather
  // than a bare "◇" — without this, every completed phase loses its label
  // when the next phase starts and the scroll history fills with empty
  // markers.
  currentSpinner.stop(currentSpinnerLabel ?? undefined);
  currentSpinner = null;
  currentSpinnerLabel = null;
}

const ctx: ScreenContext = {
  send,
  clack,
  env: process.env,
  startSpinner(label: string): void {
    currentSpinner = clack.spinner();
    currentSpinnerLabel = label;
    currentSpinner.start(label);
  },
  stopSpinner(): void {
    stopCurrentSpinner();
  },
};

async function handle(msg: { type: string; text?: string }): Promise<void> {
  clearTimeout(initialTimeout);

  switch (msg.type) {
    case 'show':
      stopCurrentSpinner();
      await handleShow(msg as Parameters<ShowHandler>[0], ctx);
      break;
    case 'progress':
      currentSpinner?.message(msg.text!);
      currentSpinnerLabel = msg.text!;
      break;
    case 'shutdown':
      stopCurrentSpinner();
      send({ type: 'exit', reason: 'shutdown-ack' });
      setTimeout(() => process.exit(0), 100);
      break;
  }
}
