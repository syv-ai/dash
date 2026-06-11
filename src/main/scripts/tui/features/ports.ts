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
  const { intro, outro, select, confirm, note, isCancel } = ctx.clack;
  const projectName = ctx.env.DASH_TUI_PROJECT_NAME ?? 'project';

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
