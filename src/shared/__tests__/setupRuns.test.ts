import { describe, it, expect } from 'vitest';
import { appendCapped, setupFailureMessage, stripAnsi } from '../setupRuns';

describe('appendCapped', () => {
  it('appends under the cap', () => {
    expect(appendCapped({ text: 'a', trimmed: false }, 'b', 10)).toEqual({
      text: 'ab',
      trimmed: false,
    });
  });

  it('cuts the front to three quarters of the cap once over it', () => {
    const out = appendCapped({ text: 'x'.repeat(100), trimmed: false }, 'y'.repeat(10), 100);
    expect(out.trimmed).toBe(true);
    expect(out.text.length).toBe(75);
    expect(out.text.endsWith('y'.repeat(10))).toBe(true);
  });

  it('starts the trimmed log at a line start when one is near', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${String(i).padStart(2, '0')}`);
    const out = appendCapped({ text: '', trimmed: false }, lines.join('\n') + '\n', 100);
    expect(out.text.startsWith('line ')).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(75);
    expect(out.text.endsWith('line 19\n')).toBe(true);
  });

  it('never grows past the cap over many appends', () => {
    let log = { text: '', trimmed: false };
    for (let i = 0; i < 500; i++) log = appendCapped(log, `chunk ${i}\n`, 1000);
    expect(log.text.length).toBeLessThanOrEqual(1000);
    expect(log.text.endsWith('chunk 499\n')).toBe(true);
  });
});

describe('stripAnsi', () => {
  it('removes colour and OSC sequences and folds CRLF', () => {
    expect(stripAnsi('\x1b[32mok\x1b[0m\r\n\x1b]0;title\x07done')).toBe('ok\ndone');
  });
});

describe('setupFailureMessage', () => {
  it('names the timeout', () => {
    expect(
      setupFailureMessage({ log: 'x', code: null, timedOut: true, timeoutMs: 600_000 }),
    ).toMatch(/^timed out after 10 min/);
  });

  it('uses the last output line and the exit code', () => {
    expect(
      setupFailureMessage({
        log: 'installing\n\x1b[31mERR_PNPM_NO_LOCKFILE\x1b[0m\n\n',
        code: 1,
        timedOut: false,
        timeoutMs: 1,
      }),
    ).toBe('ERR_PNPM_NO_LOCKFILE (exited with code 1)');
  });

  it('falls back to the exit code alone', () => {
    expect(setupFailureMessage({ log: '', code: 2, timedOut: false, timeoutMs: 1 })).toBe(
      'exited with code 2',
    );
  });
});
