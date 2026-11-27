/*
 * Coalesces a PTY's output into fewer `pty:data` IPC sends. A busy TUI writes
 * many small chunks a frame (Ink's spinner, a status region, streamed text);
 * one IPC message each costs main and the renderer far more than the bytes.
 * Chunks are joined in order and sent once OUTPUT_BATCH_MS after the first,
 * or at once when they pass OUTPUT_BATCH_MAX_CHARS. The same pattern as VS
 * Code's TerminalDataBufferer (5 ms there).
 */

/** How long the first chunk of a batch waits for others. A keystroke's echo
 *  waits at most this, well under a frame. [provisional] */
export const OUTPUT_BATCH_MS = 8;

/** A batch this large (UTF-16 code units) is sent at once, without waiting. */
export const OUTPUT_BATCH_MAX_CHARS = 64 * 1024;

export interface OutputBatcher {
  /** Queue a chunk; sent with the batch, in order. */
  push(data: string): void;
  /** Send whatever is queued now (before an exit, a kill or an owner change). */
  flush(): void;
}

export function createOutputBatcher(
  send: (data: string) => void,
  opts: { delayMs?: number; maxChars?: number } = {},
): OutputBatcher {
  const delayMs = opts.delayMs ?? OUTPUT_BATCH_MS;
  const maxChars = opts.maxChars ?? OUTPUT_BATCH_MAX_CHARS;
  let chunks: string[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (chunks.length === 0) return;
    const data = chunks.length === 1 ? chunks[0]! : chunks.join('');
    chunks = [];
    size = 0;
    send(data);
  };

  return {
    push(data) {
      if (!data) return;
      chunks.push(data);
      size += data.length;
      if (size >= maxChars) flush();
      else if (!timer) timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}
