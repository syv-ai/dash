import { describe, expect, it, vi } from 'vitest';
import { gracefulKillProc, ptySignal } from '../ptyManager';

function fakeProc() {
  let exit: ((e: { exitCode: number; signal?: number }) => void) | undefined;
  const kill = vi.fn<(signal?: string) => void>();
  return {
    kill,
    onExit: (l: (e: { exitCode: number; signal?: number }) => void) => {
      exit = l;
      return { dispose: () => {} };
    },
    exit: () => exit?.({ exitCode: 0 }),
  };
}

describe('ptySignal', () => {
  it('names the signal on POSIX and none on Windows, where node-pty throws on any', () => {
    expect(ptySignal('SIGTERM', 'darwin')).toBe('SIGTERM');
    expect(ptySignal('SIGKILL', 'linux')).toBe('SIGKILL');
    expect(ptySignal('SIGTERM', 'win32')).toBeUndefined();
  });
});

describe('gracefulKillProc', () => {
  it('on POSIX sends SIGTERM, then SIGKILL when the process outlives the timeout', async () => {
    vi.useFakeTimers();
    const p = fakeProc();
    const done = gracefulKillProc(p, 100, 'linux');
    expect(p.kill).toHaveBeenLastCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(p.kill).toHaveBeenLastCalledWith('SIGKILL');
    vi.useRealTimers();
  });

  it('on Windows kills once with no signal and still settles without an exit event', async () => {
    vi.useFakeTimers();
    const p = fakeProc();
    const done = gracefulKillProc(p, 100, 'win32');
    expect(p.kill).toHaveBeenCalledTimes(1);
    expect(p.kill).toHaveBeenCalledWith(undefined);
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(p.kill).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('settles on exit', async () => {
    const p = fakeProc();
    const done = gracefulKillProc(p, 10_000, 'darwin');
    p.exit();
    await expect(done).resolves.toBeUndefined();
  });
});
