import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';

const SCROLLBACK = 1000;

/**
 * Headless xterm mirror of a PTY's output, owned by main (the VS Code
 * pty-host pattern). The mirror is the single source of truth for "what this
 * terminal looks like" — serialized on every renderer (re)attach and
 * persisted to the snapshot files on kill/quit. Replaces the renderer-side
 * beforeunload/debounce snapshot saves, which raced the reload they were
 * trying to survive.
 */
export class TerminalMirror {
  private term: Terminal;
  private addon: SerializeAddon;

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
    this.addon = new SerializeAddon();
    // SerializeAddon is typed against the renderer Terminal; headless exposes
    // the same surface the addon needs.
    this.term.loadAddon(this.addon as never);
  }

  write(data: string): void {
    this.term.write(data);
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows);
  }

  /** Flush the async parse queue, then serialize buffer + styles. */
  serialize(): Promise<string> {
    return new Promise((resolve) => {
      this.term.write('', () => resolve(this.addon.serialize()));
    });
  }

  /**
   * Serialize without flushing the parse queue — synchronous, for quit-time
   * persistence where an async flush would race app exit. May miss a chunk
   * still in the parser; acceptable for best-effort persistence.
   */
  serializeNow(): string {
    return this.addon.serialize();
  }

  /**
   * The last `lastLines` lines of the buffer (scrollback + screen) as plain
   * text, after flushing the parse queue: no styling, soft-wrapped rows joined,
   * trailing blank rows dropped. The one way to read text out of a PTY or a
   * raw TUI byte stream (`claude logs` is a full-screen repaint with no
   * newlines, so stripping ANSI from the bytes would not give lines).
   */
  toPlainText(lastLines: number): Promise<string> {
    return new Promise((resolve) => {
      this.term.write('', () => {
        const buf = this.term.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (!line) continue;
          // Trim only at a real line end: a row that wraps into the next one
          // keeps its trailing cells, or a space on its last column is lost.
          const text = line.translateToString(!buf.getLine(i + 1)?.isWrapped);
          if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
          // A full-screen TUI leaves empty rows between its output and the input
          // box; keep one so they don't use up the caller's line budget.
          else if (text.trim() === '' && lines.length > 0 && lines[lines.length - 1]!.trim() === '')
            continue;
          else lines.push(text);
        }
        while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
        resolve(lastLines > 0 ? lines.slice(-lastLines).join('\n') : '');
      });
    });
  }

  dims(): { cols: number; rows: number } {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  dispose(): void {
    this.term.dispose();
  }
}
