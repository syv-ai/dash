import { Terminal } from '@xterm/headless';

/** A rule row: `────…` or `──── <session name> ─`, as drawn around the input box. */
function isRule(text: string): boolean {
  const t = text.trim();
  return t.startsWith('───') && t.endsWith('─');
}

/**
 * Whether Claude Code's input box, as `term` shows an attach client's screen,
 * holds text the user typed and has not sent. The box is the rows between the
 * last two rules; its first two columns are the `❯ ` prompt (or the indent of
 * a continuation row). A placeholder hint ("Press up to edit queued
 * messages") is drawn dim, typed text is not. With no box on screen (a dialog,
 * the trust prompt) the answer is false: there is nothing to merge into.
 * Reads the buffer as parsed so far.
 */
export function composerHasDraft(term: Terminal): boolean {
  const buffer = term.buffer.active;
  const rules: number[] = [];
  for (let y = buffer.length - 1; y >= 0 && rules.length < 2; y--) {
    const line = buffer.getLine(y);
    if (line && isRule(line.translateToString(true))) rules.push(y);
  }
  if (rules.length < 2) return false;
  const [bottom, top] = rules as [number, number];
  const cell = buffer.getNullCell();
  for (let y = top + 1; y < bottom; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    for (let x = 2; x < line.length; x++) {
      line.getCell(x, cell);
      if (cell.getChars().trim() && !cell.isDim()) return true;
    }
  }
  return false;
}

/**
 * Scrollback-free headless xterm of an agent attach client's screen, fed every
 * output chunk from spawn (Claude Code repaints by diff, so a screen started
 * later would be garbage). Only asked whether the input box holds a draft.
 */
export class AttachScreen {
  private term: Terminal;
  /** Chunks written but not yet parsed (xterm parses on a later tick). */
  private unparsed = 0;
  private disposed = false;
  private flushWaiters = new Set<() => void>();

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  }

  write(data: string): void {
    if (this.disposed) return;
    this.unparsed++;
    this.term.write(data, () => this.unparsed--);
  }

  resize(cols: number, rows: number): void {
    if (!this.disposed) this.term.resize(cols, rows);
  }

  /** composerHasDraft once every chunk written so far is parsed; false once disposed. */
  async hasDraft(): Promise<boolean> {
    if (this.unparsed > 0 && !this.disposed) {
      await new Promise<void>((resolve) => {
        this.flushWaiters.add(resolve);
        this.term.write('', () => {
          this.flushWaiters.delete(resolve);
          resolve();
        });
      });
    }
    return !this.disposed && composerHasDraft(this.term);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // A disposed xterm never runs its write callbacks.
    for (const resolve of this.flushWaiters) resolve();
    this.flushWaiters.clear();
    this.term.dispose();
  }
}
