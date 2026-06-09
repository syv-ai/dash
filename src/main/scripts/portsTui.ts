/**
 * Side-car TUI process for ports onboarding. Spawned by main via
 * startCommandPty as kind='tui', featureId='ports'. Connects back to main on
 * the UNIX socket whose path is passed via DASH_TUI_SOCKET. Pure renderer —
 * no fs, no file watching, no business logic.
 */
import net from 'net';
import { intro, outro, select, confirm, note, spinner, isCancel } from '@clack/prompts';
import type { MainToTui, TuiToMain } from '../../shared/portsTuiProtocol';
import { TUI_PROTOCOL_VERSION } from '../../shared/portsTuiProtocol';

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

async function handle(msg: MainToTui): Promise<void> {
  clearTimeout(initialTimeout);

  switch (msg.type) {
    case 'show':
      currentSpinner?.stop();
      currentSpinner = null;
      await showScreen(msg);
      break;
    case 'progress':
      currentSpinner?.message(msg.text);
      break;
    case 'shutdown':
      currentSpinner?.stop();
      send({ type: 'exit', reason: 'shutdown-ack' });
      setTimeout(() => process.exit(0), 100);
      break;
  }
}

async function showScreen(msg: Extract<MainToTui, { type: 'show' }>): Promise<void> {
  switch (msg.screen) {
    case 'onboarding': {
      intro(`◆  Dash — port management for ${projectName}`);
      if (msg.props.signals.length) {
        note(msg.props.signals.join('\n'), 'Signals');
      }
      if (msg.props.guesses.length) {
        note(msg.props.guesses.join('\n'), 'Guesses');
      }
      const choice = await select({
        message: 'How do you want to proceed?',
        options: [
          { value: 'setup', label: 'Set it up' },
          { value: 'not-now', label: 'Not now' },
          { value: 'not-relevant', label: 'Not relevant for this project' },
        ],
      });
      if (isCancel(choice)) {
        send({ type: 'choice', screen: 'onboarding', value: 'not-now' });
      } else {
        send({ type: 'choice', screen: 'onboarding', value: choice as never });
      }
      break;
    }

    case 'describe': {
      note(
        'Dash will install a slash command and ask your agent to set up\n' +
          "per-worktree ports. Takes ~30s–2min. You'll see progress here.\n\n" +
          'Press Enter to begin (ESC to go back).',
        'What happens next',
      );
      const choice = await select({
        message: 'Proceed?',
        options: [
          { value: 'proceed', label: 'Yes, begin' },
          { value: 'back', label: 'Go back' },
        ],
      });
      if (isCancel(choice)) {
        send({ type: 'choice', screen: 'describe', value: 'back' });
      } else {
        send({ type: 'choice', screen: 'describe', value: choice as never });
      }
      break;
    }

    case 'choose-task': {
      const choice = await select({
        message: 'Which task should run setup?',
        options: [
          { value: 'current', label: `Current task (${msg.props.currentTaskName})` },
          {
            value: 'new',
            label: `New task — "${msg.props.newTaskName}" on a new branch`,
          },
        ],
      });
      if (isCancel(choice)) {
        send({ type: 'exit', reason: 'user' });
      } else {
        send({ type: 'choice', screen: 'choose-task', value: choice as never });
      }
      break;
    }

    case 'migrating': {
      currentSpinner = spinner();
      currentSpinner.start(`Creating task "${msg.props.newTaskName}" on ${msg.props.branchName}…`);
      break;
    }

    case 'launching': {
      currentSpinner = spinner();
      currentSpinner.start('Loading the setup command into your agent…');
      break;
    }

    case 'waiting-ports-json': {
      currentSpinner = spinner();
      currentSpinner.start('Agent reading project files…');
      break;
    }

    case 'allocated-waiting-sentinel': {
      currentSpinner = spinner();
      currentSpinner.start(
        `✓ ${msg.props.count} ports allocated. Agent wiring code and writing docs…`,
      );
      break;
    }

    case 'done': {
      const c = await confirm({
        message: `${msg.props.count} ports allocated. Restart this session now to pick up the new env vars?`,
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
      currentSpinner = spinner();
      currentSpinner.start('Restarting… see you on the other side. ◢◤');
      break;
    }

    case 'exit': {
      const reason = msg.props.reason;
      const message =
        reason === 'not-now'
          ? 'No problem. Re-open this task to set up later.'
          : reason === 'not-relevant'
            ? "Got it — Dash won't ask about ports for this project again."
            : reason === 'later'
              ? 'Restart this Dash session manually when ready.'
              : reason === 'migrated'
                ? `Continuing in task "${msg.props.errorMessage ?? 'port-setup'}".`
                : `Error: ${msg.props.errorMessage ?? 'unknown'}`;
      outro(message);
      send({ type: 'exit', reason: 'user' });
      setTimeout(() => process.exit(0), 100);
      break;
    }
  }
}
