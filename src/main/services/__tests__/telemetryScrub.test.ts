import { describe, expect, it } from 'vitest';
import { scrubText } from '../telemetryScrub';

const home = '/Users/alice';

describe('scrubText', () => {
  it('replaces user paths, keeping the app bundle’s own frames readable', () => {
    const stack = [
      "Error: ENOENT: no such file or directory, open '/Users/alice/repos/secret-plan/notes.md'",
      '    at readFile (/Applications/Dash.app/Contents/Resources/app.asar/dist/main/main/services/GitService.js:12:3)',
      '    at /Users/alice/repos/dash/dist/main/main/ipc/gitIpc.js:40:9',
    ].join('\n');
    expect(scrubText(stack, { home })).toBe(
      [
        "Error: ENOENT: no such file or directory, open '<path>'",
        '    at readFile (app:/dist/main/main/services/GitService.js:12:3)',
        '    at <path>',
      ].join('\n'),
    );
  });

  it('replaces home-relative, Windows and file:// paths', () => {
    expect(scrubText('cd ~/work/acme failed', { home })).toBe('cd <path> failed');
    expect(scrubText('C:\\Users\\alice\\x.txt missing', { home: 'C:\\Users\\alice' })).toBe(
      '<path> missing',
    );
    expect(scrubText('at file:///Users/alice/a.js:1:1', { home })).toBe('at <path>');
  });

  it('redacts tokens and email addresses', () => {
    expect(
      scrubText('auth ghp_abcdefghijklmnopqrstuvwxyz0123456789 for bob@example.com', { home }),
    ).toBe('auth <redacted> for <redacted>');
    expect(scrubText('key sk-ant-api03-abcDEF_123', { home })).toBe('key <redacted>');
  });

  it('leaves plain words and relative module names alone', () => {
    expect(scrubText('TypeError: Cannot read properties of undefined (reading x)', { home })).toBe(
      'TypeError: Cannot read properties of undefined (reading x)',
    );
  });
});
