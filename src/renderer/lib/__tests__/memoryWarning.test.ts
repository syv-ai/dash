import { describe, expect, it } from 'vitest';
import type { MemoryAlert, SystemHealthSnapshot } from '@shared/systemHealth';
import {
  formatAgo,
  formatMemory,
  healthSummary,
  machineShare,
  memoryWarningCopy,
  sleepIdleLabel,
} from '../memoryWarning';

const GB = 1024 ** 3;

describe('formatMemory', () => {
  it.each([
    [9.24 * GB, '9.2 GB'],
    [GB, '1 GB'],
    [850 * 1024 ** 2, '850 MB'],
  ])('%i → %s', (b, s) => {
    expect(formatMemory(b)).toBe(s);
  });
});

describe('memoryWarningCopy', () => {
  const alert: MemoryAlert = {
    reason: 'threshold',
    totalBytes: 9.2 * GB,
    thresholdBytes: 8 * GB,
    pressure: 'normal',
    topTasks: [
      { taskId: 'a', name: 'fix/login', bytes: 2.1 * GB },
      { taskId: 'b', name: 'docs', bytes: 900 * 1024 ** 2 },
    ],
  };

  it('names the total, the threshold and the heaviest tasks', () => {
    expect(memoryWarningCopy(alert, 3)).toEqual({
      title: 'Dash is using 9.2 GB',
      description: 'Over your 8 GB warning. Heaviest: fix/login 2.1 GB, docs 900 MB.',
      action: 'Sleep 3 idle tasks',
    });
  });

  it('says why on pressure, and offers nothing when no task is idle', () => {
    const c = memoryWarningCopy({ ...alert, reason: 'pressure', topTasks: [] }, 0);
    expect(c.title).toBe('Memory is running low');
    expect(c.description).toBe('Dash and its sessions use 9.2 GB.');
    expect(c.action).toBeNull();
  });

  it('counts one task in the singular', () => {
    expect(memoryWarningCopy(alert, 1).action).toBe('Sleep 1 idle task');
  });
});

describe('sleepIdleLabel', () => {
  it('counts the idle tasks, or offers nothing at none', () => {
    expect(sleepIdleLabel(0)).toBeNull();
    expect(sleepIdleLabel(1)).toBe('Sleep 1 idle task');
    expect(sleepIdleLabel(3)).toBe('Sleep 3 idle tasks');
  });
});

describe('healthSummary', () => {
  const snapshot: SystemHealthSnapshot = {
    totalBytes: 6.8 * GB,
    thresholdBytes: 8 * GB,
    pressure: 'normal',
    level: 'ok',
    tasks: [],
    machine: null,
    sampledAt: 0,
  };

  it('says it is measuring before the first sample', () => {
    expect(healthSummary(null)).toBe('Measuring…');
  });

  it('gives the usage against the threshold, and the pressure where there is one', () => {
    expect(healthSummary(snapshot)).toBe('6.8 GB of 8 GB · Memory pressure Normal');
    expect(healthSummary({ ...snapshot, pressure: null })).toBe('6.8 GB of 8 GB');
  });
});

describe('formatAgo', () => {
  it.each([
    [0, 'Now'],
    [40_000, '40 s ago'],
    [12 * 60_000, '12 min ago'],
    [60 * 60_000, '1 h ago'],
    [80 * 60_000, '1 h 20 min ago'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatAgo(ms)).toBe(text);
  });
});

describe('machineShare', () => {
  const base: SystemHealthSnapshot = {
    totalBytes: 4 * GB,
    thresholdBytes: 6 * GB,
    pressure: null,
    level: 'ok',
    tasks: [],
    machine: { totalBytes: 32 * GB, availableBytes: 10 * GB },
    sampledAt: 0,
  };

  it('is Dash and its sessions as a percent of installed memory', () => {
    expect(machineShare(base)).toBe(12.5);
  });

  it('is null without a machine reading', () => {
    expect(machineShare({ ...base, machine: null })).toBeNull();
  });
});
