import { describe, it, expect, vi, beforeEach } from 'vitest';

type FakeWin = { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } };
const windows: FakeWin[] = [];

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => windows } }));

import { broadcast } from '../broadcast';

function fakeWin(opts: { destroyed?: boolean; throws?: boolean } = {}): FakeWin {
  return {
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      send: vi.fn(() => {
        if (opts.throws) throw new Error('gone');
      }),
    },
  };
}

describe('broadcast', () => {
  beforeEach(() => {
    windows.length = 0;
  });

  it('sends the channel and every arg to each live window', () => {
    const a = fakeWin();
    const b = fakeWin();
    windows.push(a, b);
    broadcast('git:fileChanged', 'w1', { extra: 1 });
    expect(a.webContents.send).toHaveBeenCalledWith('git:fileChanged', 'w1', { extra: 1 });
    expect(b.webContents.send).toHaveBeenCalledWith('git:fileChanged', 'w1', { extra: 1 });
  });

  it('sends with no payload when given none', () => {
    const a = fakeWin();
    windows.push(a);
    broadcast('projects:changed');
    expect(a.webContents.send).toHaveBeenCalledWith('projects:changed');
  });

  it('skips destroyed windows', () => {
    const dead = fakeWin({ destroyed: true });
    const live = fakeWin();
    windows.push(dead, live);
    broadcast('tasks:changed', { projectId: 'p' });
    expect(dead.webContents.send).not.toHaveBeenCalled();
    expect(live.webContents.send).toHaveBeenCalledOnce();
  });

  it('does not throw when a send fails, and still reaches the other windows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = fakeWin({ throws: true });
    const good = fakeWin();
    windows.push(bad, good);
    expect(() => broadcast('app:toast', { message: 'hi' })).not.toThrow();
    expect(good.webContents.send).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
