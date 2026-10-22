/**
 * Asking the person to let an agent outside Dash in, when `dashctl` finds
 * orchestrator access off. Pure (the prompt and the clock come in), so tests
 * drive it without Electron.
 *
 * - One prompt at a time: calls that arrive while one is open wait on it.
 * - After a Deny (or no answer), calls are refused without asking for
 *   `denyCooldownMs`, so an agent that retries can't keep raising the prompt.
 */

/** How long a refusal stands before a new call may ask again. */
export const DENY_COOLDOWN_MS = 2 * 60_000;

export interface AccessGateOptions {
  isAllowed: () => boolean;
  /** Shows the prompt; true when the person allows it. */
  ask: () => Promise<boolean>;
  now?: () => number;
  denyCooldownMs?: number;
}

export function createAccessGate(opts: AccessGateOptions): () => Promise<boolean> {
  const now = opts.now ?? Date.now;
  const cooldown = opts.denyCooldownMs ?? DENY_COOLDOWN_MS;
  let pending: Promise<boolean> | null = null;
  let deniedAt = -Infinity;

  return () => {
    if (opts.isAllowed()) return Promise.resolve(true);
    if (pending) return pending;
    if (now() - deniedAt < cooldown) return Promise.resolve(false);
    pending = opts
      .ask()
      .catch(() => false)
      .then((allowed) => {
        if (!allowed) deniedAt = now();
        pending = null;
        return allowed;
      });
    return pending;
  };
}
