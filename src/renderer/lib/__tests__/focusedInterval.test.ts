import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { focusedInterval, type FocusEnv } from '../focusedInterval';

/** A window whose focus the test flips by hand. */
function fakeWindow(active: boolean) {
  const listeners = new Set<() => void>();
  const env: FocusEnv = {
    isActive: () => active,
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const set = (next: boolean) => {
    active = next;
    listeners.forEach((l) => l());
  };
  return { env, set, listeners };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('focusedInterval', () => {
  it('ticks every interval while the window is active', () => {
    const tick = vi.fn();
    focusedInterval(tick, 5000, fakeWindow(true).env);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('pauses in the background and ticks at once on coming back', () => {
    const tick = vi.fn();
    const win = fakeWindow(true);
    focusedInterval(tick, 5000, win.env);
    win.set(false);
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
    win.set(true);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('starts paused when the window opens in the background', () => {
    const tick = vi.fn();
    const win = fakeWindow(false);
    focusedInterval(tick, 5000, win.env);
    vi.advanceTimersByTime(20_000);
    expect(tick).not.toHaveBeenCalled();
    win.set(true);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated focus event, keeping one timer', () => {
    const tick = vi.fn();
    const win = fakeWindow(true);
    focusedInterval(tick, 5000, win.env);
    win.set(true);
    win.set(true);
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('stops ticking and listening once stopped', () => {
    const tick = vi.fn();
    const win = fakeWindow(true);
    const stop = focusedInterval(tick, 5000, win.env);
    stop();
    expect(win.listeners.size).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
