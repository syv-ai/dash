import { describe, it, expect } from 'vitest';
import { toGitPath } from '../editorIpc';

const isWindows = process.platform === 'win32';

describe('toGitPath', () => {
  // The fix is gated to Windows: on POSIX a backslash is a legal filename
  // character, so the conversion must NOT run there. These expectations track
  // the host platform so the suite is correct on every OS.

  it('converts Windows backslash separators to forward slashes (Windows only)', () => {
    expect(toGitPath('scripts\\dev.sh')).toBe(isWindows ? 'scripts/dev.sh' : 'scripts\\dev.sh');
  });

  it('converts every separator in a deep path (Windows only)', () => {
    expect(toGitPath('a\\b\\c.py')).toBe(isWindows ? 'a/b/c.py' : 'a\\b\\c.py');
  });

  it('leaves a root-level file unchanged on all platforms', () => {
    expect(toGitPath('pyproject.toml')).toBe('pyproject.toml');
  });

  it('leaves an already-POSIX path unchanged on all platforms', () => {
    expect(toGitPath('app/foo.py')).toBe('app/foo.py');
  });
});
