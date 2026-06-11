/**
 * Side-car TUI process for ports onboarding. Spawned by main via
 * startCommandPty as kind='tui', featureId='ports'. Connects back to main on
 * the UNIX socket whose path is passed via DASH_TUI_SOCKET. Pure renderer —
 * no fs, no file watching, no business logic.
 */

// MUST run before any @clack/prompts load — see require() below. Clack samples
// isTTY at import time to pick between an in-place spinner (with cursor-up
// codes) and a non-TTY fallback that re-prints the spinner frame as a new
// line. When this process runs as `ELECTRON_RUN_AS_NODE=1 electron
// portsTui.js`, Node's TTY detection on the PTY-wrapped stdio doesn't always
// tag stdout/stderr as TTY, so without these flags the user sees the spinner
// cascade line by line. ESM imports would be hoisted above this block, so we
// `require()` Clack lazily after setting the flags.
(process.stdout as { isTTY?: boolean }).isTTY = true;
(process.stderr as { isTTY?: boolean }).isTTY = true;
process.stdout.columns ??= 80;
process.stdout.rows ??= 24;

import net from 'net';
import type {
  PortsMainToTui as MainToTui,
  PortsTuiToMain as TuiToMain,
} from '../../shared/portsTuiProtocol';
import { TUI_PROTOCOL_VERSION } from '../../shared/tuiProtocol';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { intro, outro, select, confirm, note, spinner, isCancel } =
  require('@clack/prompts') as typeof import('@clack/prompts');
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const sockPath = process.env.DASH_TUI_SOCKET;
const projectName = process.env.DASH_TUI_PROJECT_NAME ?? 'project';

if (!sockPath) {
  console.error('[portsTui] missing DASH_TUI_SOCKET');
  process.exit(1);
}

const socket = net.createConnection(sockPath);
let buffer = '';

function send(msg: TuiToMain): void {
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
      void handle(JSON.parse(line) as MainToTui);
    } catch (err) {
      send({ type: 'error', message: `bad message: ${(err as Error).message}` });
    }
  }
});

socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));

// Timeout if main never sends `show`
const initialTimeout = setTimeout(() => {
  console.error("[portsTui] Dash didn't respond within 30s; exiting.");
  process.exit(1);
}, 30_000);

let currentSpinner: ReturnType<typeof spinner> | null = null;
let currentSpinnerLabel: string | null = null;

function startSpinner(label: string): void {
  currentSpinner = spinner();
  currentSpinnerLabel = label;
  currentSpinner.start(label);
}

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

async function handle(msg: MainToTui): Promise<void> {
  clearTimeout(initialTimeout);

  switch (msg.type) {
    case 'show':
      stopCurrentSpinner();
      await showScreen(msg);
      break;
    case 'progress':
      currentSpinner?.message(msg.text);
      currentSpinnerLabel = msg.text;
      break;
    case 'shutdown':
      stopCurrentSpinner();
      send({ type: 'exit', reason: 'shutdown-ack' });
      setTimeout(() => process.exit(0), 100);
      break;
  }
}

async function showScreen(msg: Extract<MainToTui, { type: 'show' }>): Promise<void> {
  switch (msg.screen) {
    case 'onboarding': {
      intro(`◆  Dash — port management for ${projectName}`);
      const { signals, guesses } = msg.props;
      if (signals.length > 0 || guesses.length > 0) {
        const lines = [
          ...(signals.length > 0 ? [`Detected: ${signals.join(', ')}`] : []),
          ...guesses.map((g) => `  · ${g}`),
        ];
        note(lines.join('\n'), 'What Dash found');
      }
      note(
        'Setup creates a new "port-setup" task on a new branch and runs an\n' +
          'agent there that configures unique ports per worktree. ~30s–2min.',
        'How it works',
      );
      const choice = await select({
        message:
          'Want Dash to manage ports for you? Allocate unique ports per worktree automatically. No more collisions.',
        options: [
          { value: 'setup', label: 'Sure. Set it up.' },
          { value: 'not-now', label: 'Not now, go away.' },
          { value: 'not-relevant', label: 'Never for this project' },
        ],
      });
      if (isCancel(choice)) {
        send({ type: 'choice', screen: 'onboarding', value: 'not-now' });
      } else {
        send({ type: 'choice', screen: 'onboarding', value: choice as never });
      }
      break;
    }

    case 'migrating': {
      startSpinner(
        `Creating task "${msg.props.newTaskName}" on ${msg.props.branchName}… ` +
          'This terminal will shut down — see you in the other task.',
      );
      break;
    }

    case 'waiting-ports-json': {
      startSpinner('Agent does the thing..');
      break;
    }

    case 'allocated-waiting-sentinel': {
      startSpinner(`${msg.props.count} ports allocated. Awaiting completion sentinel...`);
      break;
    }

    case 'done': {
      const c = await confirm({
        message: "Job's done. Session needs a restart to pick up the new env vars. Restart?",
        initialValue: true,
      });
      if (isCancel(c)) {
        send({ type: 'choice', screen: 'done', value: 'later' });
      } else {
        send({ type: 'choice', screen: 'done', value: c ? 'restart' : 'later' });
      }
      break;
    }

    case 'restarting': {
      startSpinner('Restarting… see you on the other side. ◢◤');
      break;
    }

    case 'exit': {
      const reason = msg.props.reason;
      const message =
        reason === 'not-now'
          ? "No problem — Dash will ask again next time it's started."
          : reason === 'not-relevant'
            ? "Got it — Dash won't ask about ports for this project again."
            : reason === 'later'
              ? 'Restart this Dash session manually when ready.'
              : reason === 'migrated'
                ? 'Continuing in the new "port-setup" task.'
                : `Error: ${msg.props.errorMessage ?? 'unknown'}`;
      outro(message);
      send({ type: 'exit', reason: 'user' });
      setTimeout(() => process.exit(0), 100);
      break;
    }
  }
}
