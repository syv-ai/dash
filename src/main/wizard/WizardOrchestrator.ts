import type { WizardChannel } from './WizardChannel';
import type { MainToTui, TuiToMain } from '../../shared/tuiProtocol';

export interface WizardIo<Show, Choice> {
  socket: WizardChannel<TuiToMain<Choice>, MainToTui<Show>>;
  /**
   * Called exactly once at the end of teardown with the feature's exit
   * reason, or null when teardown was triggered without a TUI-visible exit
   * (socket yank, restart path). The host uses this to close the drawer tab,
   * drop its active entry, and decide whether to suppress auto-respawn.
   */
  onTeardown(reason: string | null): void;
}

/**
 * Base lifecycle for a side-car TUI flow. One instance per active TUI. Owns
 * the envelope (ready handshake, choice routing, exit/error/close teardown,
 * graceful shutdown dance) and resource tracking (timers, cleanups).
 * Subclasses own all feature side effects and screen sequencing.
 *
 * Invariant: taskId/projectId are locked at construction. Anywhere a
 * long-running async observes "the active task" via a live ref is a bug
 * waiting to happen — task switches must not corrupt this flow's targeting.
 */
export abstract class WizardOrchestrator<
  Show extends { type: 'show' },
  Choice extends { type: 'choice' },
> {
  private readyHandled = false;
  private tornDown = false;
  private exitReason: string | null = null;
  private timers = new Map<string, NodeJS.Timeout>();
  private cleanups: Array<() => void> = [];

  constructor(
    protected readonly taskId: string,
    protected readonly projectId: string,
    private readonly io: WizardIo<Show, Choice>,
  ) {}

  async start(): Promise<void> {
    this.onCleanup(this.io.socket.onMessage((m) => void this.handleMessage(m)));
    this.onCleanup(this.io.socket.onClose(() => void this.teardown()));
    await this.onStart();
  }

  /** Optional pre-ready work (heuristics, event subscriptions). */
  protected async onStart(): Promise<void> {
    /* default: nothing */
  }

  /** First (and only) 'ready' from the side-car. Show the initial screen here. */
  protected abstract onReady(): Promise<void>;

  /** A feature 'choice' message from the side-car. */
  protected abstract onChoice(msg: Choice): Promise<void>;

  /** The feature's exit screen for exit(); shown before teardown. */
  protected abstract exitScreen(reason: string, errorMessage?: string): Show;

  private async handleMessage(m: TuiToMain<Choice>): Promise<void> {
    const type = (m as { type?: string }).type;
    if (type === 'ready') {
      // Dup-ready guard: a side-car reconnect must not reset the flow
      // mid-state or stack a second timeout.
      if (this.readyHandled) return;
      this.readyHandled = true;
      await this.onReady();
      return;
    }
    if (type === 'choice') {
      await this.onChoice(m as Choice);
      return;
    }
    if (type === 'exit' || type === 'error') {
      await this.teardown();
    }
  }

  protected async show(msg: Show): Promise<void> {
    try {
      await this.io.socket.send(msg);
    } catch {
      // Socket may already be closed; teardown handles cleanup.
    }
  }

  protected async progress(text: string): Promise<void> {
    try {
      await this.io.socket.send({ type: 'progress', text } as MainToTui<Show>);
    } catch {
      // Socket may already be closed.
    }
  }

  /** Set (replacing any previous timer under the same key). Cleared at teardown. */
  protected setTimer(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    this.timers.set(key, setTimeout(fn, ms));
  }

  protected clearTimer(key: string): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
  }

  /** Register teardown work (event unsubscribers). Runs once, best-effort. */
  protected onCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  protected async exit(reason: string, errorMessage?: string): Promise<void> {
    this.exitReason = reason;
    await this.show(this.exitScreen(reason, errorMessage));
    await this.teardown();
  }

  async teardown(): Promise<void> {
    // Idempotent — socket close and exit-message paths both land here.
    if (this.tornDown) return;
    this.tornDown = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const fn of this.cleanups) {
      try {
        fn();
      } catch {
        // Cleanup must not break teardown.
      }
    }
    // Tell the side-car to shut down gracefully BEFORE yanking the socket.
    // Without this, the side-car's `socket.on('close')` handler hard-exits
    // via process.exit(0), Clack sees its render loop interrupted, and
    // prints "Canceled" as a SIGINT-style fallback — leaving the user
    // staring at a mangled final frame. The side-car's shutdown handler
    // stops the current spinner cleanly, acks, and exits on its own timer.
    try {
      await this.io.socket.send({ type: 'shutdown' } as MainToTui<Show>);
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch {
      // Side-car already gone — fall through to unconditional close.
    }
    try {
      await this.io.socket.close();
    } catch {
      // Already closed.
    }
    try {
      this.io.onTeardown(this.exitReason);
    } catch {
      // Host cleanup must not break teardown.
    }
  }
}
