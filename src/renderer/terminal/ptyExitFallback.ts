export type PtyExitFallback =
  | { action: 'respawn-shell' }
  | { action: 'detached' }
  | { action: 'reattach' }
  | { action: 'message'; message: string };

/** PTY id prefix of an attach client for a session that belongs to no task. */
export const FOREIGN_SESSION_PTY_PREFIX = 'session:';

/** Job id when `id` is a foreign-session attach pane, else null. */
export function foreignSessionJobId(id: string): string | null {
  return id.startsWith(FOREIGN_SESSION_PTY_PREFIX)
    ? id.slice(FOREIGN_SESSION_PTY_PREFIX.length) || null
    : null;
}

/**
 * Decides what the renderer does when a tab's PTY exits. Shell tabs fall
 * back to a fresh interactive shell. Agent panes are `claude attach` clients
 * whose exit means "detached" (Esc out of agent view, Ctrl+Z, session
 * stopped) — the session lives on under the supervisor, so the pane shows a
 * Detached card with Re-attach instead of a shell. Main-spawned tabs
 * (service runs, side-car TUIs) must NOT respawn — a respawned shell would
 * make `hasPty(tabId)` true again, so ServiceRunner.status would report the
 * dead service as Dash-owned and Stop would kill an innocent shell.
 *
 * `reattach` is main's hint that Dash itself cycled the session (tasks.send
 * resuming it, the API's tasks.restart) and is starting it again: an agent
 * pane re-attaches on its own instead of showing the card.
 */
export function ptyExitFallback(
  tabId: string,
  isTui: boolean,
  shellOnly = tabId.startsWith('shell:'),
  reattach = false,
): PtyExitFallback {
  if (isTui) {
    if (tabId.startsWith('service:') && !tabId.endsWith(':logs')) {
      return {
        action: 'message',
        message: 'Service exited — press Run in the Ports panel to start it again.',
      };
    }
    return { action: 'message', message: 'Process exited — you can close this tab.' };
  }
  if (shellOnly) return { action: 'respawn-shell' };
  return reattach ? { action: 'reattach' } : { action: 'detached' };
}

/** How long a pane shows "Reconnecting…" before it falls back to Detached. */
export const REATTACH_TIMEOUT_MS = 30_000;

/**
 * Run a re-attach attempt, true only when it reports success within
 * `timeoutMs`. A rejection or a late answer counts as failure.
 */
export function reattachWithin(
  attempt: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    attempt().then(
      (ok) => {
        clearTimeout(timer);
        resolve(ok);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}
