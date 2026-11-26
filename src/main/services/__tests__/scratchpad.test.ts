import { describe, expect, it } from 'vitest';
import { deriveScratchpadDir, scratchpadFromPayload } from '../scratchpad';

const mac = {
  platform: 'darwin' as const,
  uid: 501,
  tmpOverride: undefined,
  osTmp: '/var/folders/x',
};

describe('deriveScratchpadDir', () => {
  it('follows the documented macOS layout under /private/tmp', () => {
    expect(deriveScratchpadDir('/Users/me/repo/.claude/worktrees/t-1', 'abc-123', mac)).toBe(
      '/private/tmp/claude-501/-Users-me-repo--claude-worktrees-t-1/abc-123/scratchpad',
    );
  });

  it('moves under CLAUDE_CODE_TMPDIR, and under os.tmpdir() on Linux', () => {
    expect(deriveScratchpadDir('/r', 's', { ...mac, tmpOverride: '/scratch' })).toBe(
      '/scratch/claude-501/-r/s/scratchpad',
    );
    expect(deriveScratchpadDir('/r', 's', { ...mac, platform: 'linux', osTmp: '/tmp' })).toBe(
      '/tmp/claude-501/-r/s/scratchpad',
    );
  });

  it("doesn't guess on Windows, without a uid, or for a session id that isn't one", () => {
    expect(deriveScratchpadDir('C:\\r', 's', { ...mac, platform: 'win32' })).toBeNull();
    expect(deriveScratchpadDir('/r', 's', { ...mac, uid: undefined })).toBeNull();
    expect(deriveScratchpadDir('/r', '../etc', mac)).toBeNull();
  });
});

describe('scratchpadFromPayload', () => {
  it('takes an absolute scratchpad_dir only', () => {
    expect(scratchpadFromPayload({ scratchpad_dir: '/t/s/scratchpad/' })).toBe('/t/s/scratchpad');
    expect(scratchpadFromPayload({ scratchpad_dir: 'rel/scratchpad' })).toBeNull();
    expect(scratchpadFromPayload({ scratchpad_dir: 3 })).toBeNull();
    expect(scratchpadFromPayload({})).toBeNull();
  });
});
