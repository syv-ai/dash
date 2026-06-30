import type { ActivityState, LoopConfig, LoopRunState, LoopStatus } from '@shared/types';

/**
 * Side-effecting operations the scheduler drives. Injected so the iteration /
 * policy state machine below is unit-testable without Electron, PTYs, or a real
 * shell (see LoopScheduler.test.ts). The Electron adapter wires these to
 * ptyManager + child_process + LoopService.
 */
export interface LoopDriver {
  /** Spawn a FRESH worker (Ralph reset) for `iteration`, auto-running `prompt`. */
  spawnWorker(iteration: number, prompt: string): Promise<void>;
  /** Kill the current worker PTY so the next iteration starts cold. */
  killWorker(): Promise<void>;
  /** Run the stop-predicate command; resolves true when it exits 0 ("done"). */
  runShellCheck(command: string): Promise<boolean>;
  /** Whether the most recent worker iteration's output contained `needle`. */
  workerOutputContains(needle: string): boolean;
  emitStatus(status: LoopStatus): void;
  appendRunLog(entry: string): Promise<void>;
  now(): number;
  /** Schedule `cb` after `ms`; returns a cancel fn. (cadence waits.) */
  setTimer(ms: number, cb: () => void): () => void;
}

/**
 * Owns the loop's iteration `while`. Dash drives the boundary between Ralph
 * iterations — that is where budget gates, the stop check, and pause/kill live.
 *
 * Lifecycle: `start()` runs iteration 1. Each iteration the worker goes
 * busy→idle; on idle the scheduler runs the policy's stop check and either
 * finishes or resets into a fresh next iteration. `pause`/`resume`/`stop` and
 * `noteTokens` (budget auto-pause) are the manager/human control points.
 */
export class LoopScheduler {
  private state: LoopRunState = 'idle';
  private iteration = 0;
  private sawBusyThisIteration = false;
  private tokensSpent = 0;
  private cancelTimer: (() => void) | null = null;
  private reason: string | undefined;
  /** Guards against re-entrant iteration completion while a check is in flight. */
  private evaluating = false;

  constructor(
    readonly taskId: string,
    private readonly config: LoopConfig,
    /** The per-iteration worker prompt (LoopService.workerIterationPrompt). */
    private readonly workerPrompt: string,
    private readonly driver: LoopDriver,
  ) {}

  getStatus(): LoopStatus {
    return {
      taskId: this.taskId,
      state: this.state,
      iteration: this.iteration,
      maxIterations: this.config.maxIterations ?? null,
      reason: this.reason,
      tokensSpent: this.tokensSpent,
      tokenBudget: this.config.tokenBudget ?? null,
      updatedAt: this.driver.now(),
    };
  }

  isActive(): boolean {
    return this.state === 'running' || this.state === 'paused';
  }

  async start(): Promise<void> {
    if (this.isActive()) return;
    this.state = 'running';
    this.iteration = 1;
    this.reason = undefined;
    await this.beginIteration();
  }

  /** Called by the adapter on every worker activity transition. */
  notifyWorkerState(state: ActivityState): void {
    if (this.state !== 'running') return;
    if (state === 'busy') {
      this.sawBusyThisIteration = true;
      return;
    }
    // Only a busy→idle edge means "iteration finished" — the idle emitted at
    // PTY registration (before any work) must not advance the loop.
    if (state === 'idle' && this.sawBusyThisIteration) {
      void this.onIterationComplete();
    }
  }

  pause(reason = 'paused'): void {
    if (this.state !== 'running') return;
    this.cancelPendingTimer();
    this.state = 'paused';
    this.reason = reason;
    this.driver.emitStatus(this.getStatus());
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.reason = undefined;
    this.driver.emitStatus(this.getStatus());
    // The worker is idle (we paused after an iteration) — kick the next one.
    await this.nextIteration();
  }

  async stop(reason = 'stopped by user'): Promise<void> {
    if (this.state === 'stopped' || this.state === 'done') return;
    this.cancelPendingTimer();
    this.state = 'stopped';
    this.reason = reason;
    await this.driver.killWorker();
    await this.driver.appendRunLog(this.logLine(`stopped — ${reason}`));
    this.driver.emitStatus(this.getStatus());
  }

  /** Report cumulative token spend; auto-pause when the budget is exceeded. */
  noteTokens(totalTokens: number): void {
    this.tokensSpent = totalTokens;
    const budget = this.config.tokenBudget;
    if (budget != null && this.tokensSpent >= budget && this.state === 'running') {
      void this.driver.appendRunLog(
        this.logLine(`budget exceeded (${this.tokensSpent}/${budget} tokens) — auto-paused`),
      );
      this.pause('token budget exceeded — human review needed');
      return;
    }
    this.driver.emitStatus(this.getStatus());
  }

  // ── internals ─────────────────────────────────────────────

  private async beginIteration(): Promise<void> {
    this.sawBusyThisIteration = false;
    this.driver.emitStatus(this.getStatus());
    await this.driver.spawnWorker(this.iteration, this.workerPrompt);
  }

  private async nextIteration(): Promise<void> {
    this.iteration += 1;
    await this.driver.killWorker(); // Ralph reset: fresh context next pass.
    await this.beginIteration();
  }

  private async onIterationComplete(): Promise<void> {
    if (this.evaluating || this.state !== 'running') return;
    this.evaluating = true;
    try {
      const done = await this.isGoalSatisfied();
      await this.driver.appendRunLog(
        this.logLine(
          `iteration ${this.iteration} complete — ${done ? 'stop check PASSED' : 'continue'}`,
        ),
      );
      if (done) {
        this.finish('done', 'stop check passed');
        return;
      }
      const max = this.config.maxIterations;
      if (max != null && this.iteration >= max) {
        this.finish('stopped', `reached max iterations (${max})`);
        return;
      }
      // A pause()/stop() that raced the (awaited) stop check must not be
      // overridden by spawning the next iteration. Re-check after the await.
      if (this.state !== 'running') return;
      // Continue. Cadence policy waits between runs; the rest reset immediately.
      if (this.config.policy === 'cadence') {
        if (this.config.cadenceMs && this.config.cadenceMs > 0) {
          this.cancelTimer = this.driver.setTimer(this.config.cadenceMs, () => {
            this.cancelTimer = null;
            if (this.state === 'running') void this.nextIteration();
          });
        } else {
          // Misconfigured cadence loop: pause rather than busy-spawn workers
          // with no delay (a runaway). A human can set an interval and resume.
          this.pause('cadence loop has no interval configured');
        }
      } else {
        await this.nextIteration();
      }
    } finally {
      this.evaluating = false;
    }
  }

  /** Policy-specific stop predicate. The ONLY place a loop decides it's done. */
  private async isGoalSatisfied(): Promise<boolean> {
    switch (this.config.policy) {
      case 'cadence':
        // A cadence loop (triage/babysitter) never self-terminates.
        return false;
      case 'count':
        return this.config.completionPromise
          ? this.driver.workerOutputContains(this.config.completionPromise)
          : false;
      case 'ralph':
      case 'goal':
        // External verification, never self-grading. No check ⇒ run to max.
        return this.config.stopPredicate
          ? await this.driver.runShellCheck(this.config.stopPredicate)
          : false;
    }
  }

  private finish(state: 'done' | 'stopped', reason: string): void {
    this.state = state;
    this.reason = reason;
    void this.driver.appendRunLog(this.logLine(`finished (${state}) — ${reason}`));
    this.driver.emitStatus(this.getStatus());
    // Leave the worker terminal alive so the user can read the final state.
  }

  private cancelPendingTimer(): void {
    if (this.cancelTimer) {
      this.cancelTimer();
      this.cancelTimer = null;
    }
  }

  private logLine(msg: string): string {
    return `${new Date(this.driver.now()).toISOString()} · iter ${this.iteration} · ${msg}`;
  }
}
