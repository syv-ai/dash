export type PtyExitFallback = { action: 'respawn-shell' } | { action: 'message'; message: string };

/**
 * Decides what the renderer does when a tab's PTY exits. Agent/shell tabs
 * deliberately fall back to a fresh interactive shell. Main-spawned tabs
 * (service runs, side-car TUIs) must NOT — a respawned shell would make
 * `hasPty(tabId)` true again, so ServiceRunner.status would report the dead
 * service as Dash-owned and Stop would kill an innocent shell.
 */
export function ptyExitFallback(tabId: string, isTui: boolean): PtyExitFallback {
  if (!isTui) return { action: 'respawn-shell' };
  if (tabId.startsWith('service:') && !tabId.endsWith(':logs')) {
    return {
      action: 'message',
      message: 'Service exited — press Run in the Ports panel to start it again.',
    };
  }
  return { action: 'message', message: 'Process exited — you can close this tab.' };
}
