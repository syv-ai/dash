import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import { portLivenessService } from '../PortLivenessService';

/** Nothing listens on port 1; the probes only need to not throw. */
const PORTS = [1];
const isWatched = (taskId: string) => Object.keys(portLivenessService.getStates(taskId)).length > 0;

beforeEach(() => {
  vi.useFakeTimers();
  portLivenessService.clearAll();
});

afterEach(() => {
  portLivenessService.clearAll();
  vi.useRealTimers();
});

describe('PortLivenessService ownership', () => {
  it('an API lease expires on its own', () => {
    portLivenessService.leaseTask('t', PORTS, 60_000);
    expect(isWatched('t')).toBe(true);
    vi.advanceTimersByTime(59_000);
    expect(isWatched('t')).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(isWatched('t')).toBe(false);
  });

  it('a repeated lease pushes the expiry out', () => {
    portLivenessService.leaseTask('t', PORTS, 60_000);
    vi.advanceTimersByTime(50_000);
    portLivenessService.leaseTask('t', PORTS, 60_000);
    vi.advanceTimersByTime(50_000);
    expect(isWatched('t')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(isWatched('t')).toBe(false);
  });

  it("an expiring lease never stops the renderer's watch", () => {
    portLivenessService.watchTask('t', PORTS);
    portLivenessService.leaseTask('t', PORTS, 60_000);
    vi.advanceTimersByTime(60_000);
    expect(isWatched('t')).toBe(true);
  });

  it('the renderer unwatching leaves a live lease running', () => {
    portLivenessService.leaseTask('t', PORTS, 60_000);
    portLivenessService.watchTask('t', PORTS);
    portLivenessService.unwatchTask('t');
    expect(isWatched('t')).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(isWatched('t')).toBe(false);
  });

  it('forgetTask stops every watch on the task', () => {
    portLivenessService.watchTask('t', PORTS);
    portLivenessService.leaseTask('t', PORTS, 60_000);
    portLivenessService.forgetTask('t');
    expect(isWatched('t')).toBe(false);
    // The lease timer went with it: a later renderer watch is not cut short.
    portLivenessService.watchTask('t', PORTS);
    vi.advanceTimersByTime(60_000);
    expect(isWatched('t')).toBe(true);
  });
});
