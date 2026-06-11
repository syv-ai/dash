import type { EventEmitter } from 'events';
import type { TuiSocketServer } from './TuiSocketServer';
import type { MainToTui, TuiToMain, ExitReason } from '../../shared/portsTuiProtocol';
import { portsDebug } from './PortsDebugLog';

type State =
  | 'pending-ready'
  | 'onboarding'
  | 'waiting-ports-json'
  | 'allocated-waiting-sentinel'
  | 'done'
  | 'restarting'
  | 'exit';

const POLL_MAX_DURATION_MS = 30 * 60_000; // 30-min cap waiting for ports.json
const SENTINEL_FALLBACK_MS = 20 * 60_000; // 20-min cap waiting for setup-complete

interface Services {
  heuristic: { run(opts: { taskId: string }): Promise<{ signals: string[]; guesses: string[] }> };
  /**
   * Read-only: the watcher already re-ran WorkspacePortsRuntime.setupTask
   * before emitting 'ports:config', so the orchestrator only needs the
   * resulting allocation count for display.
   */
  runtime: { getPortCount(taskId: string): Promise<number> };
  /**
   * Emits 'ports:config' and 'ports:setupComplete' with { taskId } payloads
   * via `events`. `startWatching`/`stopWatching` are pre-bound to this
   * orchestrator's task — the orchestrator holds its own refcount from
   * start() through teardown() so the watcher stays armed even if the
   * renderer's drawer unmounts mid-flow.
   */
  configWatcher: {
    events: EventEmitter;
    startWatching(): void;
    stopWatching(): void;
  };
  sessionRegistry: { restartAllForTask(taskId: string): Promise<void> };
  drawerTabs: {
    add(taskId: string, opts: unknown): { id: string };
    close(tabId: string): void;
  };
  dismissStore: {
    isDismissed(projectId: string): boolean;
    markDismissed(projectId: string): void;
  };
  /**
   * Hand-off to the host when the user picks "Set it up" in ONBOARDING. The
   * host is responsible for:
   *   - creating a fresh 'port-setup' worktree task on a new branch
   *   - stashing the inlined setup prompt for the new agent PTY
   *   - switching the renderer's active task to it
   *   - spawning a fresh orchestrator in the new task's drawer at LAUNCHING,
   *     pre-seeded with the same signals/guesses so the new TUI doesn't re-run
   *     the heuristic on an empty worktree
   * Resolves once the new TUI is spawned; this orchestrator then teardowns.
   */
  migrate(opts: { signals: string[]; guesses: string[] }): Promise<void>;
  /**
   * Called exactly once at the end of teardown with the exit reason, or null
   * when teardown was triggered without a TUI-visible exit (socket yank,
   * restart path). The host uses this to drop its activeTuis entry and decide
   * whether to suppress auto-respawn for the rest of the session.
   */
  onTeardown(reason: ExitReason | null): void;
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
 * Owns every side effect (heuristic, migrate hand-off, sentinel watching,
 * session restart, drawer tab close). The side-car TUI process is a dumb
 * renderer; this orchestrator drives it.
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
  private watcherRefHeld = false;
  private tornDown = false;
  private exitReason: ExitReason | null = null;
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
    services.configWatcher.events.on('ports:config', onConfig);
    services.configWatcher.events.on('ports:setupComplete', onComplete);
    this.offPortsConfig = () => services.configWatcher.events.off('ports:config', onConfig);
    this.offSetupComplete = () =>
      services.configWatcher.events.off('ports:setupComplete', onComplete);

    // Hold a protective ref on the fs.watch so the renderer's drawer can
    // mount/unmount without killing the watcher mid-flow (e.g. while we're
    // waiting for the agent to write .dash/ports.json). Released in teardown.
    services.configWatcher.startWatching();
    this.watcherRefHeld = true;

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
    // 'ready' is only meaningful from pending-ready. A duplicate (e.g. a
    // side-car reconnect) must not reset the flow mid-state and stack a
    // second poll timer.
    if (this.state !== 'pending-ready') return;
    if (this.initialState === 'launching') {
      // Migrate path: the new task's `claude` process was spawned with
      // `/dash-port-setup signals: …; guesses: …` as its initial positional
      // prompt (see portsTuiIpc.handleMigrate). CC auto-submits that prompt
      // the instant the user accepts the trust gate, so the orchestrator
      // doesn't need to inject keystrokes or wait for a session-ready hook.
      // Sit on the waiting-ports-json spinner until the agent writes
      // .dash/ports.json.
      this.state = 'waiting-ports-json';
      await this.send({ type: 'show', screen: 'waiting-ports-json' });
      this.pollTimeout = setTimeout(() => {
        void this.exit('error', "Agent didn't write ports.json within 30 minutes.");
      }, POLL_MAX_DURATION_MS);
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
        // Setup ALWAYS runs in a new port-setup task — no "use current task"
        // path. Show the migrating spinner, then hand off to the host's
        // migrate(): it creates the worktree, stashes the inlined setup
        // prompt for the new agent PTY, switches the renderer's active task,
        // and spawns a fresh orchestrator in the new task's drawer
        // (initialState='launching', signals/guesses preset). We teardown
        // once migrate resolves.
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
      } else if (m.value === 'not-now') {
        await this.exit('not-now');
      } else {
        this.opts.services.dismissStore.markDismissed(this.projectId);
        await this.exit('not-relevant');
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

    const count = await this.opts.services.runtime.getPortCount(this.taskId);
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
    this.exitReason = reason;
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

  async teardown(): Promise<void> {
    // Idempotent — socket close and exit-message paths both call teardown,
    // and we must not double-decrement the watcher refcount.
    if (this.tornDown) return;
    this.tornDown = true;
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    if (this.sentinelTimeout) clearTimeout(this.sentinelTimeout);
    this.offPortsConfig?.();
    this.offSetupComplete?.();
    this.offMessage?.();
    this.offClose?.();
    // Release the protective ref taken in start(). If no other holder is
    // left (drawer unmounted, no defensive arms outstanding), the fs.watch
    // closes here.
    if (this.watcherRefHeld) {
      this.watcherRefHeld = false;
      try {
        this.opts.services.configWatcher.stopWatching();
      } catch {
        /* never throws in practice */
      }
    }
    // Tell the side-car to shut down gracefully BEFORE yanking the socket.
    // Without this, the side-car's `socket.on('close')` handler hard-exits
    // via process.exit(0), Clack sees its render loop interrupted, and
    // prints "Canceled" as a SIGINT-style fallback message — leaving the
    // user staring at a mangled final frame. The shutdown handler in the
    // side-car (portsTui.ts) stops the current spinner cleanly, sends an
    // exit-ack, and exits via its own 100ms timer.
    try {
      await this.opts.socket.send({ type: 'shutdown' });
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch {
      /* side-car already gone — fall through to unconditional close */
    }
    if (this.tabId) this.opts.services.drawerTabs.close(this.tabId);
    try {
      await this.opts.socket.close();
    } catch {
      /* already closed */
    }
    try {
      this.opts.services.onTeardown(this.exitReason);
    } catch {
      /* host cleanup must not break teardown */
    }
  }
}
