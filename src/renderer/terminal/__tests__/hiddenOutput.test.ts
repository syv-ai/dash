import { describe, expect, it } from 'vitest';
import { HiddenOutput } from '../hiddenOutput';

describe('HiddenOutput', () => {
  it('holds chunks and hands them back in order, then starts over', () => {
    const h = new HiddenOutput(100);
    expect(h.push('a')).toEqual([]);
    expect(h.push('b')).toEqual([]);
    expect(h.take()).toEqual(['a', 'b']);
    expect(h.take()).toEqual([]);
  });

  it('holds up to the cap', () => {
    const h = new HiddenOutput(4);
    expect(h.push('ab')).toEqual([]);
    expect(h.push('cd')).toEqual([]);
    expect(h.take()).toEqual(['ab', 'cd']);
  });

  it('past the cap writes what it held, then each chunk live until shown', () => {
    const h = new HiddenOutput(4);
    h.push('abc');
    expect(h.push('de')).toEqual(['abc', 'de']);
    expect(h.push('f')).toEqual(['f']);
    expect(h.take()).toEqual([]);
    expect(h.push('g')).toEqual([]);
    expect(h.take()).toEqual(['g']);
  });

  it.each([
    ['DA1', '\x1b[c'],
    ['DA2', '\x1b[>0c'],
    ['CPR', '\x1b[6n'],
    ['DECRQM', '\x1b[?2026$p'],
    ['XTVERSION', '\x1b[>q'],
    ['OSC 11', '\x1b]11;?\x07'],
    ['DECRQSS', '\x1bP$qm\x1b\\'],
  ])('writes through at once on a %s query, in order, then holds again', (_, q) => {
    const h = new HiddenOutput(100);
    h.push('a');
    expect(h.push(`b${q}`)).toEqual(['a', `b${q}`]);
    expect(h.push('c')).toEqual([]);
    expect(h.take()).toEqual(['c']);
  });

  it('catches a query split across chunks', () => {
    const h = new HiddenOutput(100);
    expect(h.push('x\x1b[')).toEqual([]);
    expect(h.push('6n')).toEqual(['x\x1b[', '6n']);
  });

  it('does not take ordinary output for a query', () => {
    const h = new HiddenOutput(100);
    expect(h.push('\x1b[2J\x1b[H\x1b[38;5;214mhi\x1b[0m\x1b[?25l')).toEqual([]);
  });

  it('clear forgets the chunks and going live', () => {
    const h = new HiddenOutput(2);
    h.push('abc');
    h.clear();
    expect(h.push('a')).toEqual([]);
    expect(h.take()).toEqual(['a']);
  });
});
