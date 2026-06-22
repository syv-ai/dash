import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitScheduler } from '../FitScheduler';

describe('FitScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires fit once after the debounce delay for a visible resize', () => {
    const fit = vi.fn();
    const scheduler = new FitScheduler(fit, 250);
    scheduler.onResize(300);
    expect(fit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('debounces a burst of visible resizes into one fit', () => {
    const fit = vi.fn();
    const scheduler = new FitScheduler(fit, 250);
    scheduler.onResize(300);
    vi.advanceTimersByTime(100);
    scheduler.onResize(200);
    vi.advanceTimersByTime(100);
    scheduler.onResize(150);
    vi.advanceTimersByTime(250);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending fit when the container goes hidden (collapse regression)', () => {
    const fit = vi.fn();
    const scheduler = new FitScheduler(fit, 250);
    // Shrink animation: intermediate visible heights schedule a fit...
    scheduler.onResize(120);
    vi.advanceTimersByTime(50);
    scheduler.onResize(20);
    vi.advanceTimersByTime(50);
    // ...then the container collapses to 0 — the pending fit must die with it,
    // otherwise it measures a hidden container and squashes the PTY to 1 row.
    scheduler.onResize(0);
    vi.advanceTimersByTime(1000);
    expect(fit).not.toHaveBeenCalled();
  });

  it('schedules normally again after a hidden period (expand)', () => {
    const fit = vi.fn();
    const scheduler = new FitScheduler(fit, 250);
    scheduler.onResize(20);
    scheduler.onResize(0);
    vi.advanceTimersByTime(1000);
    scheduler.onResize(300);
    vi.advanceTimersByTime(250);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('cancel() clears a pending fit', () => {
    const fit = vi.fn();
    const scheduler = new FitScheduler(fit, 250);
    scheduler.onResize(300);
    scheduler.cancel();
    vi.advanceTimersByTime(1000);
    expect(fit).not.toHaveBeenCalled();
  });
});
