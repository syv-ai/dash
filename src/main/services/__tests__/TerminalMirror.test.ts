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
});
