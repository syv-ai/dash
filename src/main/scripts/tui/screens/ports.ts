import type {
  PortsMainToTui,
  PortsTuiToMain,
  ExitReason,
} from '../../../../shared/portsTuiProtocol';
import type { ScreenContext, ShowHandler } from '../types';

type ShowMsg = Extract<PortsMainToTui, { type: 'show' }>;

function send(ctx: ScreenContext, msg: PortsTuiToMain): void {
  ctx.send(msg);
}

export const showPortsScreen: ShowHandler = async (raw, ctx) => {
  const msg = raw as ShowMsg;
  const { outro, select, confirm, isCancel } = ctx.clack;

  switch (msg.screen) {
    case 'onboarding': {
      const choice = await select({
        // Blank lines (gutter-prefixed by clack's trim:false wrapping) separate
        // the pitch, the action note, and the options for breathing room.
        message:
          'Managing services on different ports per worktree can get messy. ' +
          'If you add a .dash/ports.json to your project, Dash can solve this and ' +
          'let you start and stop services directly from the UI. No more collisions.\n\n' +
          'Do you want to set it up? This starts a new task and instructs an agent to do the thing.\n',
        options: [
          { value: 'setup', label: 'Sure. Set it up.' },
          { value: 'not-now', label: 'Not now, go away.' },
          { value: 'not-relevant', label: 'Never for this project' },
        ],
      });
      if (isCancel(choice)) {
        send(ctx, { type: 'choice', screen: 'onboarding', value: 'not-now' });
      } else {
        send(ctx, { type: 'choice', screen: 'onboarding', value: choice as never });
      }
      break;
    }

    case 'migrating': {
      ctx.startSpinner(
        `Creating task "${msg.props.newTaskName}" on ${msg.props.branchName}… ` +
          'This terminal will shut down — see you in the other task.',
      );
      break;
    }

    case 'waiting-ports-json': {
      ctx.startSpinner('Agent does the thing..');
      break;
    }

    case 'config-invalid': {
      // Drop the waiting spinner, print the validation errors, then resume
      // waiting — the agent (or user) fixes ports.json and we advance.
      ctx.stopSpinner();
      ctx.clack.log.error(
        `ports.json is invalid:\n${msg.props.errors.map((e) => `  • ${e}`).join('\n')}`,
      );
      ctx.startSpinner('Waiting for a corrected ports.json…');
      break;
    }

    case 'allocated-waiting-sentinel': {
      ctx.startSpinner(`${msg.props.count} ports allocated. Awaiting completion sentinel...`);
      break;
    }

    case 'done': {
      const c = await confirm({
        message: "Job's done. Session needs a restart to pick up the new env vars. Restart?",
        initialValue: true,
      });
      if (isCancel(c)) {
        send(ctx, { type: 'choice', screen: 'done', value: 'later' });
      } else {
        send(ctx, { type: 'choice', screen: 'done', value: c ? 'restart' : 'later' });
      }
      break;
    }

    case 'restarting': {
      ctx.startSpinner('Restarting… see you on the other side. ◢◤');
      break;
    }

    case 'exit': {
      const reason: ExitReason = msg.props.reason;
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
      send(ctx, { type: 'exit', reason: 'user' });
      setTimeout(() => process.exit(0), 100);
      break;
    }
  }
};
