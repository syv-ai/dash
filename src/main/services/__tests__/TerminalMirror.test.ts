import { describe, it, expect } from 'vitest';
import { TerminalMirror } from '../TerminalMirror';

describe('TerminalMirror', () => {
  it('serializes written content', async () => {
    const m = new TerminalMirror(80, 24);
    m.write('hello mirror\r\nline two\r\n');
    const state = await m.serialize();
    expect(state).toContain('hello mirror');
    expect(state).toContain('line two');
    m.dispose();
  });

  it('survives resize and keeps scrollback bounded', async () => {
    const m = new TerminalMirror(80, 24);
    for (let i = 0; i < 2000; i++) m.write(`line ${i}\r\n`);
    m.resize(100, 30);
    const state = await m.serialize();
    expect(state).toContain('line 1999');
    expect(state).not.toContain('line 0\r'); // beyond the 1000-line scrollback
    expect(m.dims()).toEqual({ cols: 100, rows: 30 });
    m.dispose();
  });

  it('toPlainText drops ANSI and returns the last N lines', async () => {
    const m = new TerminalMirror(80, 24);
    m.write('\x1b[31mred one\x1b[0m\r\n\x1b[1mtwo\x1b[22m\r\nthree\r\n\r\n');
    expect(await m.toPlainText(2)).toBe('two\nthree');
    expect(await m.toPlainText(10)).toBe('red one\ntwo\nthree');
    m.dispose();
  });

  it('toPlainText reads a full-screen repaint stream as the final screen', async () => {
    const m = new TerminalMirror(40, 10);
    // `claude logs` style: clear, home, cursor moves, no newlines.
    m.write('\x1b7\x1b8\x1b[2J\x1b[Hold screen\x1b[2J\x1b[H\x1b[3;1Hhello\x1b[5;1Hworld');
    expect(await m.toPlainText(3)).toBe('hello\n\nworld');
    m.dispose();
  });

  it('toPlainText collapses blank runs so a TUI gap does not eat the line budget', async () => {
    const m = new TerminalMirror(40, 20);
    // Claude Code's TUI: the reply near the top, the input box at the bottom,
    // and empty rows in between.
    m.write('\x1b[2J\x1b[H\x1b[2;1HNO-DASH\x1b[4;1Hdone\x1b[18;1H---\x1b[19;1H>\x1b[20;1Hmode');
    expect(await m.toPlainText(6)).toBe(
      'NO-DASH\n\ndone\n\n---\n>\nmode'.split('\n').slice(-6).join('\n'),
    );
    expect(await m.toPlainText(7)).toBe('NO-DASH\n\ndone\n\n---\n>\nmode');
    m.dispose();
  });

  it('toPlainText joins soft-wrapped rows into one line', async () => {
    const m = new TerminalMirror(10, 5);
    m.write('abcdefghijklmno\r\nnext');
    expect(await m.toPlainText(5)).toBe('abcdefghijklmno\nnext');
    m.dispose();
  });
});
