import type { EventEmitter } from 'events';
import type { TuiSocketServer } from './TuiSocketServer';
import type { MainToTui, TuiToMain, ExitReason } from '../../shared/portsTuiProtocol';
import { portsDebug } from './PortsDebugLog';

type State =
  | 'pending-ready'
  | 'onboarding'
  | 'describe'
  | 'choose-task'
  | 'pre-launch-confirm'
  | 'launching'
  | 'waiting-ports-json'
  | 'allocated-waiting-sentinel'
  | 'done'
  | 'restarting'
  | 'exit';

const POLL_MAX_DURATION_MS = 30 * 60_000; // 30-min cap waiting for ports.json
const SENTINEL_FALLBACK_MS = 20 * 60_000; // 20-min cap waiting for setup-complete
/**
 * After SessionStart(startup) fires for a migrated task's agent PTY, wait this
 * long without any further permission_prompt notification before deciding
 * Claude Code is settled and ready to receive slash commands. Restarts on
 * every permission_prompt so back-to-back modals (directory + MCPs) extend
 * the window naturally.
 */
const READY_SETTLE_MS = 5_000;
/**
 * Hard ceiling on the auto-detect path. If we don't see SessionStart(startup)
 * or never reach a settled state within this window, fall back to the manual
 * pre-launch-confirm screen so the user can drive proceed manually. Empirically
 * Claude Code doesn't always fire SessionStart(startup) before its first-run
 * prompts (or possibly not at all), so we don't want this to block the user
 * for long.
 */
const READY_TIMEOUT_MS = 20_000;

interface Services {
  heuristic: { run(opts: { taskId: string }): Promise<{ signals: string[]; guesses: string[] }> };
  installer: { install(opts: { taskId: string }): Promise<void> };
  runtime: { setupTask(taskId: string): Promise<{ count: number }> };
  /** Emits 'ports:config' and 'ports:setupComplete' with { taskId } payloads. */
  configWatcher: EventEmitter;
  /**
   * Emits 'agent-startup' { ptyId } when SessionStart(startup) fires for any
   * agent PTY, and 'permission-prompt' { ptyId } when Claude Code shows a
   * permission modal. The orchestrator uses these to detect when a freshly-
   * migrated task's Claude session is past first-run prompts before auto-
   * submitting slash commands.
   */
  hookEvents: EventEmitter;
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
  /**
   * Hand-off to the host when the user picks "New task" in CHOOSE_TASK. The
   * host is responsible for:
   *   - creating a 'port-setup' worktree task on a new branch
   *   - switching the renderer's active task to it
   *   - spawning a fresh orchestrator in the new task's drawer at LAUNCHING,
   *     pre-seeded with the same signals/guesses so the new TUI doesn't re-run
   *     the heuristic on an empty worktree (the wiring will be on the new
   *     branch but the heuristic source files are checked out fresh).
   * Resolves once the new TUI is spawned; this orchestrator then teardowns.
   */
  migrate(opts: { signals: string[]; guesses: string[] }): Promise<void>;
}

interface Opts {
  taskId: string;
  projectId: string;
  taskName: string;
  projectName: string;
  initialState: 'onboarding' | 'launching';
  /**
   * Pre-seeded heuristic output. Set by the migrate path so the new
   * orchestrator (initialState='launching') reuses the original task's
   * signals/guesses without re-running the heuristic. Ignored when
   * initialState='onboarding'.
   */
  presetSignalsGuesses?: { signals: string[]; guesses: string[] };
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
    portsDebug.log('orch', 'start', {
      taskId: this.taskId,
      projectId: this.projectId,
      initialState: this.initialState,
    });
    const { socket, services } = this.opts;

    this.offMessage = socket.onMessage((m) => {
      void this.onMessage(m);
    });
    this.offClose = socket.onClose(() => {
      void this.teardown();
    });

    const onConfig = (payload: { taskId: string }) => {
      portsDebug.log('orch', 'heard ports:config', {
        payloadTaskId: payload.taskId,
        wanted: this.taskId,
        state: this.state,
      });
      if (payload.taskId === this.taskId) void this.onPortsConfig();
    };
    const onComplete = (payload: { taskId: string }) => {
      portsDebug.log('orch', 'heard ports:setupComplete', {
        payloadTaskId: payload.taskId,
        wanted: this.taskId,
        state: this.state,
      });
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
    } else if (this.opts.presetSignalsGuesses) {
      this.signals = this.opts.presetSignalsGuesses.signals;
      this.guesses = this.opts.presetSignalsGuesses.guesses;
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
      // Migrate path: the new task's Claude Code session is starting fresh and
      // is likely to prompt the user for directory trust / MCP approvals. We
      // race against those by waiting for SessionStart(startup) + a settle
      // window with no permission_prompts. If hooks land cleanly, we auto-
      // submit. If we time out (90s), fall back to the manual pre-launch-
      // confirm screen so the user can drive it.
      this.state = 'pre-launch-confirm';
      await this.send({ type: 'show', screen: 'launching' });

      const auto = await this.waitForAgentReady();
      if (auto === 'ready') {
        await this.toLaunching();
        return;
      }

      // Auto-detect timed out — fall back to manual confirm.
      await this.send({
        type: 'show',
        screen: 'pre-launch-confirm',
        props: { taskName: this.opts.taskName },
      });
    } else {
      this.state = 'onboarding';
      await this.send({
        type: 'show',
        screen: 'onboarding',
        props: { signals: this.signals, guesses: this.guesses },
      });
    }
  }

  private waitForAgentReady(): Promise<'ready' | 'timeout'> {
    return new Promise((resolve) => {
      const { hookEvents } = this.opts.services;
      let startupSeen = false;
      let settleTimer: NodeJS.Timeout | null = null;
      let hardTimer: NodeJS.Timeout | null = null;
      const taskId = this.taskId;

      const onStartup = (e: { ptyId: string }) => {
        if (e.ptyId !== taskId) return;
        startupSeen = true;
        scheduleSettle();
      };
      const onPermission = (e: { ptyId: string }) => {
        if (e.ptyId !== taskId) return;
        startupSeen = true;
        scheduleSettle();
      };

      const scheduleSettle = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (!startupSeen) return;
          cleanup();
          resolve('ready');
        }, READY_SETTLE_MS);
      };

      const cleanup = () => {
        hookEvents.off('agent-startup', onStartup);
        hookEvents.off('permission-prompt', onPermission);
        if (settleTimer) clearTimeout(settleTimer);
        if (hardTimer) clearTimeout(hardTimer);
      };

      hookEvents.on('agent-startup', onStartup);
      hookEvents.on('permission-prompt', onPermission);

      hardTimer = setTimeout(() => {
        cleanup();
        resolve('timeout');
      }, READY_TIMEOUT_MS);
    });
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
        // The orchestrator shows the MIGRATING spinner, then hands off to the
        // host via services.migrate() to create the worktree task, switch the
        // active task in the renderer, and spawn a fresh orchestrator in the
        // new task's drawer (initialState='launching', signals/guesses preset).
        // We then teardown — the new instance takes it from here.
        await this.send({
          type: 'show',
          screen: 'migrating',
          props: { newTaskName: 'port-setup', branchName: 'dash/port-setup' },
        });
        try {
          await this.opts.services.migrate({
            signals: this.signals,
            guesses: this.guesses,
          });
          await this.exit('migrated');
        } catch (err) {
          await this.exit(
            'error',
            `Couldn't create port-setup task: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return;
    }

    if (m.screen === 'pre-launch-confirm') {
      if (m.value === 'continue') {
        await this.toLaunching();
      } else {
        await this.exit('later');
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
    portsDebug.log('orch', 'toLaunching enter', { taskId: this.taskId });
    this.state = 'launching';
    await this.send({ type: 'show', screen: 'launching' });

    await this.opts.services.installer.install({ taskId: this.taskId });
    portsDebug.log('orch', 'installer.install done', { taskId: this.taskId });
    await this.opts.services.agentSender.sendKeys(this.taskId, '/reload-skills\r');
    portsDebug.log('orch', 'sent /reload-skills', { taskId: this.taskId });

    // 500ms gap between slash commands matches the live invariant — sending
    // \n between two commands collapses them into one input line; sending
    // back-to-back \r without a gap races the TUI input handler.
    setTimeout(async () => {
      const cmd = `/dash-port-setup signals: ${this.signals.join(', ')}; guesses: ${this.guesses.join(', ')}\r`;
      await this.opts.services.agentSender.sendKeys(this.taskId, cmd);
      portsDebug.log('orch', 'sent /dash-port-setup', { taskId: this.taskId });

      this.state = 'waiting-ports-json';
      await this.send({ type: 'show', screen: 'waiting-ports-json' });
      portsDebug.log('orch', 'transitioned to waiting-ports-json', { taskId: this.taskId });

      this.pollTimeout = setTimeout(() => {
        void this.exit('error', "Agent didn't write ports.json within 30 minutes.");
      }, POLL_MAX_DURATION_MS);
    }, 500);
  }

  private async onPortsConfig(): Promise<void> {
    portsDebug.log('orch', 'onPortsConfig entered', {
      taskId: this.taskId,
      state: this.state,
    });
    if (this.state !== 'waiting-ports-json') {
      portsDebug.log('orch', 'onPortsConfig ignored (wrong state)', {
        taskId: this.taskId,
        state: this.state,
      });
      return;
    }
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
