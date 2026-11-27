/*
 * Output for a kept task terminal while it is hidden (D59). xterm would parse
 * every chunk for a screen nobody sees, so the raw chunks wait here instead
 * and are written when the terminal is shown again. Past the cap the buffer
 * is dropped and the terminal marked stale: replaying that much would cost
 * more than asking Claude Code for a fresh screen, which a new `claude
 * attach` client paints in full.
 */

/** Chars (UTF-16 code units) held for a hidden terminal before it goes
 *  stale. About 20 ms of xterm parsing to replay. [provisional] */
export const HIDDEN_OUTPUT_MAX_CHARS = 1024 * 1024;

/** What showing the terminal again takes: these chunks written, in order, or
 *  (stale) a fresh screen. */
export type HiddenOutputTake = { stale: false; chunks: string[] } | { stale: true };

export class HiddenOutput {
  private chunks: string[] = [];
  private size = 0;
  private stale = false;

  constructor(private readonly maxChars = HIDDEN_OUTPUT_MAX_CHARS) {}

  push(data: string): void {
    if (this.stale) return;
    this.size += data.length;
    if (this.size > this.maxChars) {
      this.chunks = [];
      this.size = 0;
      this.stale = true;
      return;
    }
    this.chunks.push(data);
  }

  /** The held output, emptied: the buffer starts over. */
  take(): HiddenOutputTake {
    const taken: HiddenOutputTake = this.stale
      ? { stale: true }
      : { stale: false, chunks: this.chunks };
    this.clear();
    return taken;
  }

  /** Forget it all (the terminal was reset, so it no longer applies). */
  clear(): void {
    this.chunks = [];
    this.size = 0;
    this.stale = false;
  }
}
