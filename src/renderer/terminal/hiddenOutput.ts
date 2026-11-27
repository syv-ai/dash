/*
 * Output for a kept task terminal while it is hidden (D59). xterm would parse
 * every chunk for a screen nobody sees, so the raw chunks wait here instead
 * and are written when the terminal is shown again. Two things write through
 * at once instead:
 * - a terminal query (device attributes, cursor position, a colour query):
 *   the program waits on xterm's reply, so the held output and the query are
 *   parsed now, in order;
 * - past the cap, the held output is written and the terminal goes back to
 *   parsing as output arrives, the cost it had before holding, so showing it
 *   never waits on a replay longer than the cap.
 */

/** Chars (UTF-16 code units) held for a hidden terminal before it parses
 *  live again. About 20 ms of xterm parsing to replay. [provisional] */
export const HIDDEN_OUTPUT_MAX_CHARS = 1024 * 1024;

/**
 * Sequences xterm answers: DA1/DA2/DA3 (`CSI c`, `CSI > c`, `CSI = c`), DSR
 * and CPR (`CSI 5 n`, `CSI 6 n`, `CSI ? 6 n`), DECRQM (`CSI ? Ps $ p`),
 * XTVERSION (`CSI > q`), window reports (`CSI 14/16/18 t`), DECRQSS
 * (`DCS $ q`) and colour queries (`OSC 4/10/11/12 … ?`).
 */
const QUERY =
  // eslint-disable-next-line no-control-regex
  /\x1b\[(?:[>=]?0?c|\??[56]n|\??\d+\$p|>0?q|1[468]t)|\x1bP\$q|\x1b\](?:4;\d+|1[012]);\?/;

/** Long enough to hold the start of any QUERY split across two chunks. */
const TAIL = 16;

export class HiddenOutput {
  private chunks: string[] = [];
  private size = 0;
  private live = false;
  private tail = '';

  constructor(private readonly maxChars = HIDDEN_OUTPUT_MAX_CHARS) {}

  /**
   * Hold a chunk. Returns what to write now, in order: nothing while it
   * holds, everything held plus this chunk on a query or at the cap, and
   * each chunk as it comes once past the cap.
   */
  push(data: string): string[] {
    if (this.live) return [data];
    const query = QUERY.test(this.tail + data);
    // A query written through is answered; only an unfinished one carries on.
    this.tail = query ? '' : (this.tail + data).slice(-TAIL);
    this.chunks.push(data);
    this.size += data.length;
    if (!query && this.size <= this.maxChars) return [];
    const out = this.chunks;
    this.chunks = [];
    this.size = 0;
    if (!query) this.live = true;
    return out;
  }

  /** The held output, emptied; holding starts over (the terminal is shown). */
  take(): string[] {
    const out = this.chunks;
    this.clear();
    return out;
  }

  /** Forget it all (the terminal was reset, so it no longer applies). */
  clear(): void {
    this.chunks = [];
    this.size = 0;
    this.live = false;
    this.tail = '';
  }
}
