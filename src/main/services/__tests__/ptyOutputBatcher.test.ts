import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutputBatcher } from '../ptyOutputBatcher';

describe('createOutputBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the chunks of one window as one message, in order', () => {
    const sent: string[] = [];
    const b = createOutputBatcher((d) => sent.push(d), { delayMs: 8 });
    b.push('a');
    b.push('b');
    b.push('c');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(8);
    expect(sent).toEqual(['abc']);
  });

  it('times the window from the first chunk, not the last', () => {
    const sent: string[] = [];
    const b = createOutputBatcher((d) => sent.push(d), { delayMs: 8 });
    b.push('a');
    vi.advanceTimersByTime(5);
    b.push('b');
    vi.advanceTimersByTime(3);
    expect(sent).toEqual(['ab']);
    b.push('c');
    vi.advanceTimersByTime(8);
    expect(sent).toEqual(['ab', 'c']);
  });

  it('sends at once past the size cap, keeping order with what follows', () => {
    const sent: string[] = [];
    const b = createOutputBatcher((d) => sent.push(d), { delayMs: 8, maxChars: 4 });
    b.push('ab');
    b.push('cd');
    expect(sent).toEqual(['abcd']);
    b.push('e');
    vi.advanceTimersByTime(8);
    expect(sent).toEqual(['abcd', 'e']);
  });

  it('flush sends what is queued now and cancels the timer (exit, kill, owner change)', () => {
    const sent: string[] = [];
    const b = createOutputBatcher((d) => sent.push(d), { delayMs: 8 });
    b.push('last words');
    b.flush();
    expect(sent).toEqual(['last words']);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual(['last words']);
  });

  it('flush with nothing queued sends nothing; empty chunks are ignored', () => {
    const send = vi.fn();
    const b = createOutputBatcher(send);
    b.push('');
    b.flush();
    vi.advanceTimersByTime(100);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps byte order across many windows', () => {
    const sent: string[] = [];
    const b = createOutputBatcher((d) => sent.push(d), { delayMs: 8, maxChars: 50 });
    let expected = '';
    for (let i = 0; i < 500; i++) {
      const chunk = `<${i}>`;
      expected += chunk;
      b.push(chunk);
      if (i % 7 === 0) vi.advanceTimersByTime(3);
    }
    b.flush();
    expect(sent.join('')).toBe(expected);
  });
});
