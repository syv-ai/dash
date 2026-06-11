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

  dims(): { cols: number; rows: number } {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  dispose(): void {
    this.term.dispose();
  }
}
