/** Losses within this window count toward the fallback. */
export const WEBGL_LOSS_WINDOW_MS = 60_000;
/** This many losses within the window move a terminal to the DOM renderer. */
export const WEBGL_MAX_LOSSES = 3;

/**
 * Records a WebGL context loss and decides whether the terminal reloads WebGL
 * or stays on xterm's DOM renderer. Chromium caps active WebGL contexts per
 * renderer (~16) and drops the oldest past that, so a reload can push another
 * terminal over the cap. Falling back after repeated losses keeps a loss from
 * ever looping.
 */
export function recordContextLoss(
  losses: readonly number[],
  now: number,
): { losses: number[]; fallback: boolean } {
  const recent = [...losses.filter((t) => now - t < WEBGL_LOSS_WINDOW_MS), now];
  return { losses: recent, fallback: recent.length >= WEBGL_MAX_LOSSES };
}
