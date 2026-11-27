/*
 * Kept terminals (D59): the K most recently viewed task terminals stay ready
 * (xterm, WebGL context and the `claude attach` client in main); one that
 * falls out of the K is disposed at once. The session keeps running under the
 * supervisor and its hooks keep driving the status orb; opening the task
 * attaches a fresh client, which repaints the whole screen (K1–K4).
 *
 * K is the "Terminals kept ready" setting. Chromium allows about 16 active
 * WebGL contexts per renderer and force-loses the oldest past that, so the
 * range tops out at 14, leaving room for the session attach modal.
 */

export const KEPT_READY_MIN = 2;
export const KEPT_READY_MAX = 14;
export const KEPT_READY_DEFAULT = 5;

/** Rounds and clamps a kept-ready count into KEPT_READY_MIN..MAX. */
export function clampKeptReady(n: number): number {
  if (!Number.isFinite(n)) return KEPT_READY_DEFAULT;
  return Math.min(KEPT_READY_MAX, Math.max(KEPT_READY_MIN, Math.round(n)));
}

/** `id` viewed now: the recency order, most recent first. */
export function markViewed(order: readonly string[], id: string): string[] {
  return [id, ...order.filter((x) => x !== id)];
}

/**
 * The terminals to dispose: every one past the `keep` most recent, except
 * those `held` (on screen, mid-restart, remote control on). A held one stays
 * until a later pass finds it free.
 */
export function pickEvictions(
  order: readonly string[],
  keep: number,
  held: (id: string) => boolean,
): string[] {
  return order.slice(keep).filter((id) => !held(id));
}
