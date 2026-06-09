import type { EventEmitter } from 'events';
import type { TuiSocketServer } from './TuiSocketServer';
import type { MainToTui, TuiToMain, ExitReason } from '../../shared/portsTuiProtocol';

type State =
  | 'pending-ready'
  | 'onboarding'
  | 'describe'
  | 'choose-task'
  | 'launching'
  | 'waiting-ports-json'
  | 'allocated-waiting-sentinel'
  | 'done'
  | 'restarting'
  | 'exit';

const POLL_MAX_DURATION_MS = 30 * 60_000; // 30-min cap waiting for ports.json
const SENTINEL_FALLBACK_MS = 20 * 60_000; // 20-min cap waiting for setup-complete

interface Services {
  heuristic: { run(opts: { taskId: string }): Promise<{ signals: string[]; guesses: string[] }> };
  installer: { install(opts: { taskId: string }): Promise<void> };
  runtime: { setupTask(taskId: string): Promise<{ count: number }> };
  /** Emits 'ports:config' and 'ports:setupComplete' with { taskId } payloads. */
  configWatcher: EventEmitter;
  sessionRegistry: { restartAllForTask(taskId: string): Promise<void> };
  drawerTabs: {
    add(taskId: string, opts: unknown): { id: string };
    close(tabId: string): void;
  };
  dismissStore: {
    isDismissed(projectId: string): boolean;
    markDismissed(projectId: string): void;
  };
  agentSender: { sendKeys(taskId: string, text: string): Promise<void> };
}

interface Opts {
  taskId: string;
  projectId: string;
  taskName: string;
  projectName: string;
  initialState: 'onboarding' | 'launching';
  socket: TuiSocketServer;
  services: Services;
}

/**
 * State machine for the ports onboarding TUI. One instance per active TUI.
 * Owns every side effect (heuristic, slash-command install, agent keystrokes,
 * sentinel watching, session restart, drawer tab close). The side-car TUI
 * process is a dumb renderer; this orchestrator drives it.
 *
 * Invariant: taskId/projectId are locked at construction. Anywhere a
 * long-running async observes "the active task" via a live ref is a bug
 * waiting to happen — task switches must not corrupt this flow's targeting.
 */
export class PortsOnboardingOrchestrator {
  private state: State = 'pending-ready';
  private signals: string[] = [];
  private guesses: string[] = [];
  private allocatedCount = 0;
  private pollTimeout: NodeJS.Timeout | null = null;
  private sentinelTimeout: NodeJS.Timeout | null = null;
  private tabId: string | null = null;
  private offPortsConfig: (() => void) | null = null;
  private offSetupComplete: (() => void) | null = null;
  private offMessage: (() => void) | null = null;
  private offClose: (() => void) | null = null;
  private readonly taskId: string;
  private readonly projectId: string;
  private readonly initialState: 'onboarding' | 'launching';

  constructor(private readonly opts: Opts) {
    this.taskId = opts.taskId;
    this.projectId = opts.projectId;
    this.initialState = opts.initialState;
  }

  setTabId(id: string): void {
    this.tabId = id;
  }

  async start(): Promise<void> {
    const { socket, services } = this.opts;

    this.offMessage = socket.onMessage((m) => {
      void this.onMessage(m);
    });
    this.offClose = socket.onClose(() => {
      void this.teardown();
    });

    const onConfig = (payload: { taskId: string }) => {
      if (payload.taskId === this.taskId) void this.onPortsConfig();
    };
    const onComplete = (payload: { taskId: string }) => {
      if (payload.taskId === this.taskId) void this.onSetupComplete();
    };
    services.configWatcher.on('ports:config', onConfig);
    services.configWatcher.on('ports:setupComplete', onComplete);
    this.offPortsConfig = () => services.configWatcher.off('ports:config', onConfig);
    this.offSetupComplete = () => services.configWatcher.off('ports:setupComplete', onComplete);

    if (this.initialState === 'onboarding') {
      const { signals, guesses } = await services.heuristic.run({ taskId: this.taskId });
      this.signals = signals;
      this.guesses = guesses;
    }
  }

  private async onMessage(m: TuiToMain): Promise<void> {
    if (m.type === 'ready') {
      await this.onReady();
      return;
    }
    if (m.type === 'choice') {
      await this.onChoice(m);
      return;
    }
    if (m.type === 'exit' || m.type === 'error') {
      await this.teardown();
    }
  }

  private async onReady(): Promise<void> {
    if (this.initialState === 'launching') {
      await this.toLaunching();
    } else {
      this.state = 'onboarding';
      await this.send({
        type: 'show',
        screen: 'onboarding',
        props: { signals: this.signals, guesses: this.guesses },
      });
    }
  }

  private async onChoice(m: Extract<TuiToMain, { type: 'choice' }>): Promise<void> {
    if (m.screen === 'onboarding') {
      if (m.value === 'setup') {
        this.state = 'describe';
        await this.send({ type: 'show', screen: 'describe' });
      } else if (m.value === 'not-now') {
        await this.exit('later');
      } else {
        this.opts.services.dismissStore.markDismissed(this.projectId);
        await this.exit('not-relevant');
      }
      return;
    }

    if (m.screen === 'describe') {
      if (m.value === 'proceed') {
        this.state = 'choose-task';
        await this.send({
          type: 'show',
          screen: 'choose-task',
          props: { currentTaskName: this.opts.taskName, newTaskName: 'port-setup' },
        });
      } else {
        this.state = 'onboarding';
        await this.send({
          type: 'show',
          screen: 'onboarding',
          props: { signals: this.signals, guesses: this.guesses },
        });
      }
      return;
    }

    if (m.screen === 'choose-task') {
      if (m.value === 'current') {
        await this.toLaunching();
      } else {
        // MIGRATING: the orchestrator signals migration; host (portsTuiIpc)
        // is responsible for creating the new task and re-spawning a fresh
        // orchestrator with initialState='launching' in the new task's drawer.
        await this.send({
          type: 'show',
          screen: 'migrating',
          props: { newTaskName: 'port-setup', branchName: 'dash/port-setup' },
        });
        await this.exit('migrated');
      }
      return;
    }

    if (m.screen === 'done') {
      if (m.value === 'restart') {
        this.state = 'restarting';
        await this.send({ type: 'show', screen: 'restarting' });
        setTimeout(async () => {
          await this.opts.services.sessionRegistry.restartAllForTask(this.taskId);
          await this.teardown();
        }, 500);
      } else {
        await this.exit('later');
      }
      return;
    }
  }

  private async toLaunching(): Promise<void> {
    this.state = 'launching';
    await this.send({ type: 'show', screen: 'launching' });

    await this.opts.services.installer.install({ taskId: this.taskId });
    await this.opts.services.agentSender.sendKeys(this.taskId, '/reload-skills\r');

    // 500ms gap between slash commands matches the live invariant — sending
    // \n between two commands collapses them into one input line; sending
    // back-to-back \r without a gap races the TUI input handler.
    setTimeout(async () => {
      const cmd = `/dash-port-setup signals: ${this.signals.join(', ')}; guesses: ${this.guesses.join(', ')}\r`;
      await this.opts.services.agentSender.sendKeys(this.taskId, cmd);

      this.state = 'waiting-ports-json';
      await this.send({ type: 'show', screen: 'waiting-ports-json' });

      this.pollTimeout = setTimeout(() => {
        void this.exit('error', "Agent didn't write ports.json within 30 minutes.");
      }, POLL_MAX_DURATION_MS);
    }, 500);
  }

  private async onPortsConfig(): Promise<void> {
    if (this.state !== 'waiting-ports-json') return;
    if (this.pollTimeout) clearTimeout(this.pollTimeout);

    const { count } = await this.opts.services.runtime.setupTask(this.taskId);
    this.allocatedCount = count;
    this.state = 'allocated-waiting-sentinel';
    await this.send({
      type: 'show',
      screen: 'allocated-waiting-sentinel',
      props: { count },
    });
    this.sentinelTimeout = setTimeout(async () => {
      // Skip to DONE with caveat — see spec's edge-cases table.
      this.state = 'done';
      await this.send({
        type: 'show',
        screen: 'done',
        props: { count: this.allocatedCount },
      });
    }, SENTINEL_FALLBACK_MS);
  }

  private async onSetupComplete(): Promise<void> {
    if (this.state !== 'allocated-waiting-sentinel') return;
    if (this.sentinelTimeout) clearTimeout(this.sentinelTimeout);
    this.state = 'done';
    await this.send({
      type: 'show',
      screen: 'done',
      props: { count: this.allocatedCount },
    });
  }

  private async exit(reason: ExitReason, errorMessage?: string): Promise<void> {
    this.state = 'exit';
    await this.send({ type: 'show', screen: 'exit', props: { reason, errorMessage } });
    await this.teardown();
  }

  private async send(msg: MainToTui): Promise<void> {
    try {
      await this.opts.socket.send(msg);
    } catch {
      // Socket may already be closed; teardown handles cleanup.
    }
  }

  private async teardown(): Promise<void> {
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    if (this.sentinelTimeout) clearTimeout(this.sentinelTimeout);
    this.offPortsConfig?.();
    this.offSetupComplete?.();
    this.offMessage?.();
    this.offClose?.();
    if (this.tabId) this.opts.services.drawerTabs.close(this.tabId);
    try {
      await this.opts.socket.close();
    } catch {
      /* already closed */
    }
  }
}
