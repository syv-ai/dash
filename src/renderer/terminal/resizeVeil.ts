/*
 * A terminal repaints visibly while its size changes: the grid lags the box
 * through a panel ease, the fit lands once it settles (FitScheduler), and the
 * program (Claude Code's TUI) redraws for the new size. A veil covers that,
 * shown as the grid's size starts to change and lifted once it has settled.
 * It also covers an agent pane while a fresh `claude attach` client starts
 * (a woken hibernated terminal, K4), until the client's first paint settles.
 */

/** Lifted this long after the fit that follows the last resize... */
export const VEIL_STABLE_MS = 150;
/** ...and once the program's redraw has gone quiet this long... */
export const VEIL_QUIET_MS = 100;
/** ...or this long after the last resize or fit, however busy the output
 *  (a program that streams never goes quiet). */
export const VEIL_CAP_MS = 600;
/** An attach that hasn't painted lifts after this long anyway (a failed
 *  start writes its own message). */
export const VEIL_WAKE_CAP_MS = 4_000;

/** What a terminal session reports to its veil. */
export type TerminalActivity =
  /** Its box resized to a different grid (columns or rows). */
  | 'resize'
  /** It fitted its grid (and the PTY) to its box. */
  | 'fit'
  /** The program wrote output. */
  | 'output'
  /** A fresh attach client is starting; nothing is painted yet. */
  | 'attach';

/**
 * When to show the veil, from a session's activity: `onChange` hears each
 * change. Timers are the host's (`setTimeout`), the clock `now`.
 */
export class ResizeVeil {
  private shown = false;
  private fitted = false;
  /** Covering an attach that hasn't painted yet. */
  private waking = false;
  private lastSize = 0;
  private lastOutput = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onChange: (shown: boolean) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  report(activity: TerminalActivity): void {
    const t = this.now();
    if (activity === 'output') {
      this.lastOutput = t;
      if (!this.waking) return;
      // The client's first paint: lift once its redraw settles, as after a fit.
      this.waking = false;
      this.fitted = true;
    } else if (activity === 'attach') {
      this.waking = true;
      if (!this.shown) this.set(true);
    } else if (activity === 'resize') {
      this.fitted = false;
      if (!this.shown) this.set(true);
    } else {
      if (!this.shown) return;
      this.fitted = true;
    }
    this.lastSize = t;
    this.schedule(t);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private schedule(t: number): void {
    clearTimeout(this.timer);
    const due = this.dueAt();
    this.timer = setTimeout(() => this.check(), Math.max(0, due - t));
  }

  /** When the veil may lift, on what is known now. */
  private dueAt(): number {
    if (this.waking) return this.lastSize + VEIL_WAKE_CAP_MS;
    const cap = this.lastSize + VEIL_CAP_MS;
    if (!this.fitted) return cap;
    const settled = Math.max(this.lastSize + VEIL_STABLE_MS, this.lastOutput + VEIL_QUIET_MS);
    return Math.min(settled, cap);
  }

  private check(): void {
    const t = this.now();
    if (t + 0.5 >= this.dueAt()) this.set(false);
    else this.schedule(t);
  }

  private set(shown: boolean): void {
    this.shown = shown;
    this.onChange(shown);
  }
}
