/*
 * Hibernation: a task's terminal that nobody has looked at for a while is
 * disposed (its xterm, WebGL context and `claude attach` client in main) to
 * save memory. The Claude Code session keeps running under the supervisor and
 * its hooks keep driving the status orb; opening the task attaches a fresh
 * client, which repaints the whole screen, so nothing needs keeping (K1–K3).
 */

/** A task's terminal hibernates after this long unseen. */
export const HIBERNATE_AFTER_MS = 15 * 60_000;

/** How a kept terminal stands, for the hibernation check. */
export interface TerminalRest {
  /** A task's agent pane: not a drawer shell, side-car TUI, service tab or
   *  foreign session. */
  taskPane: boolean;
  /** Mounted in a pane now (the open task, or the session attach modal). */
  shown: boolean;
  /** When it was last hidden (or created, if never shown). */
  hiddenAt: number;
  /** A restart or reconnect is in flight. */
  busy: boolean;
  /** Remote control is on: main drops its state with the attach client. */
  remoteControl: boolean;
}

export function shouldHibernate(
  t: TerminalRest,
  now: number,
  afterMs = HIBERNATE_AFTER_MS,
): boolean {
  if (!t.taskPane || t.shown || t.busy || t.remoteControl) return false;
  return now - t.hiddenAt > afterMs;
}

/** The threshold, or a dev override in ms (`VITE_DASH_HIBERNATE_AFTER_MS`). */
export function hibernateAfterMs(override: string | undefined): number {
  const n = Number(override);
  return override && Number.isFinite(n) && n > 0 ? Math.round(n) : HIBERNATE_AFTER_MS;
}

/** How often to check: once a minute, or a quarter of a shorter threshold. */
export function sweepEveryMs(afterMs: number): number {
  return Math.min(60_000, Math.max(1_000, Math.round(afterMs / 4)));
}
