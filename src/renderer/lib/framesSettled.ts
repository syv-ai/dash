/** A frame this far after the last one is on time (60 Hz, with slack). */
const ON_TIME_MS = 24;

/** Whether the frame times `stamps` (rAF timestamps, oldest first) end in
 *  `run` on-time frames in a row. */
export function framesSettled(stamps: readonly number[], run = 2): boolean {
  if (stamps.length < run + 1) return false;
  for (let i = stamps.length - run; i < stamps.length; i++) {
    if (stamps[i]! - stamps[i - 1]! > ON_TIME_MS) return false;
  }
  return true;
}

/**
 * Calls `done` once frames arrive on time again (the long frames of a mount
 * or a layout are over), or after `capMs`, whichever comes first, from a task
 * of its own. Returns a cancel.
 */
export function whenFramesSettle(done: () => void, capMs: number): () => void {
  const stamps: number[] = [];
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    cancelAnimationFrame(raf);
    clearTimeout(cap);
    timer = setTimeout(done);
  };
  const tick = (t: number) => {
    stamps.push(t);
    if (framesSettled(stamps)) finish();
    else raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const cap = setTimeout(finish, capMs);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(cap);
    clearTimeout(timer);
  };
}
