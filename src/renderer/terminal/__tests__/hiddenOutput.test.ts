import { describe, expect, it } from 'vitest';
import { HiddenOutput } from '../hiddenOutput';

describe('HiddenOutput', () => {
  it('hands back the held chunks in order, then starts over', () => {
    const h = new HiddenOutput(100);
    h.push('a');
    h.push('b');
    expect(h.take()).toEqual({ stale: false, chunks: ['a', 'b'] });
    expect(h.take()).toEqual({ stale: false, chunks: [] });
  });

  it('holds up to the cap', () => {
    const h = new HiddenOutput(4);
    h.push('ab');
    h.push('cd');
    expect(h.take()).toEqual({ stale: false, chunks: ['ab', 'cd'] });
  });

  it('goes stale past the cap and stays stale until taken', () => {
    const h = new HiddenOutput(4);
    h.push('abc');
    h.push('de');
    h.push('f');
    expect(h.take()).toEqual({ stale: true });
    h.push('g');
    expect(h.take()).toEqual({ stale: false, chunks: ['g'] });
  });

  it('clear forgets the chunks and the stale mark', () => {
    const h = new HiddenOutput(2);
    h.push('abc');
    h.clear();
    expect(h.take()).toEqual({ stale: false, chunks: [] });
  });
});
