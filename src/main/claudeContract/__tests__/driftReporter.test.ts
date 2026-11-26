import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DRIFT_LOG_FILE, DRIFT_LOG_ROTATED_FILE, DriftReporter } from '../driftReporter';
import { parseDriftLog } from '../driftLedger';
import type { DriftReport } from '../types';

const drift: DriftReport = {
  claudeVersion: '2.1.332',
  source: 'statusline',
  kind: 'unexpected-field',
  path: 'brand_new',
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-drift-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const readLog = () => parseDriftLog(fs.readFileSync(path.join(dir, DRIFT_LOG_FILE), 'utf8'));

describe('DriftReporter', () => {
  it('sends a new drift once and logs every sighting with a count', () => {
    const send = vi.fn(() => true);
    const reporter = new DriftReporter({ dir, send, now: () => new Date(0) });
    reporter.report(drift);
    reporter.report(drift);
    reporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(readLog()).toEqual([
      {
        ...drift,
        firstSeen: '1970-01-01T00:00:00.000Z',
        lastSeen: '1970-01-01T00:00:00.000Z',
        count: 2,
        sent: true,
      },
    ]);
  });

  it("doesn't send it again on the next launch", () => {
    new DriftReporter({ dir, send: () => true }).report(drift);
    const first = new DriftReporter({ dir, send: () => true });
    first.report(drift);
    first.flush();
    const send = vi.fn(() => true);
    const next = new DriftReporter({ dir, send });
    next.report(drift);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends on a later launch a drift seen while telemetry was off', () => {
    const off = new DriftReporter({ dir, send: () => false });
    off.report(drift);
    off.flush();
    const send = vi.fn(() => true);
    new DriftReporter({ dir, send }).report(drift);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the sink does', () => {
    const reporter = new DriftReporter({
      dir,
      send: () => {
        throw new Error('boom');
      },
    });
    expect(() => reporter.report(drift)).not.toThrow();
  });

  it('rotates what exceeds the cap into the second file', () => {
    let t = 0;
    const reporter = new DriftReporter({
      dir,
      send: () => true,
      now: () => new Date(t++),
      maxLogBytes: 300,
    });
    for (const p of ['a', 'b', 'c']) reporter.report({ ...drift, path: p });
    reporter.flush();
    const rotated = parseDriftLog(fs.readFileSync(path.join(dir, DRIFT_LOG_ROTATED_FILE), 'utf8'));
    expect(readLog().map((r) => r.path)).toEqual(['c']);
    expect(rotated.map((r) => r.path)).toEqual(['b', 'a']);
  });

  it('writes the log once for a burst, after the delay', () => {
    vi.useFakeTimers();
    try {
      const reporter = new DriftReporter({ dir, send: () => true, flushDelayMs: 1000 });
      reporter.report(drift);
      expect(fs.existsSync(path.join(dir, DRIFT_LOG_FILE))).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(readLog()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
