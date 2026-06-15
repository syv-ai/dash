import { describe, it, expect } from 'vitest';
import { tuiSocketPath, MAX_UNIX_SOCKET_PATH } from '../tuiSocketPath';

const REAL_DIR = '/Users/nicolaibthomsen/Library/Application Support/Dash/sockets';

describe('tuiSocketPath', () => {
  it('builds a tui-prefixed .sock path under the socket dir', () => {
    expect(tuiSocketPath(REAL_DIR, 'ports', 'ae551046')).toBe(
      `${REAL_DIR}/tui-ports-ae551046.sock`,
    );
  });

  it('does not embed the 36-char task UUID (the source of the overflow)', () => {
    const p = tuiSocketPath(REAL_DIR, 'ports', 'ae551046');
    // a v4-style uuid is 36 chars; the basename must be far shorter
    expect(p.split('/').pop()!.length).toBeLessThan(36);
  });

  it('stays within the macOS AF_UNIX path limit for a realistic socket dir', () => {
    // This exact dir produced a 124-byte path under the old taskId-embedding
    // scheme, overflowing the 104-byte limit and truncating the random token.
    const p = tuiSocketPath(REAL_DIR, 'ports', 'ae551046');
    expect(p.length).toBeLessThan(MAX_UNIX_SOCKET_PATH);
  });

  it('stays within the limit even with a longer username and feature id', () => {
    const deep = '/Users/a-rather-long-username-here/Library/Application Support/Dash/sockets';
    const p = tuiSocketPath(deep, 'portsmanagement', 'deadbeef');
    expect(p.length).toBeLessThan(MAX_UNIX_SOCKET_PATH);
  });
});
