import { describe, expect, it } from 'vitest';
import type { ActivityInfo } from '@shared/types';
import type { MemoryAlert } from '@shared/systemHealth';
import { formatMemory, idleTaskIds, memoryWarningCopy } from '../memoryWarning';

const GB = 1024 ** 3;

describe('idleTaskIds', () => {
  const activity: Record<string, ActivityInfo> = {
    done: { state: 'idle' },
    open: { state: 'idle' },
    working: { state: 'busy' },
    asking: { state: 'waiting' },
    failed: { state: 'error' },
    asleep: { state: 'stopped' },
    compacting: { state: 'idle', compacting: true },
  };

  it('takes live sessions at rest, never the task on screen', () => {
    expect(idleTaskIds(activity, 'open')).toEqual(['done']);
    expect(idleTaskIds(activity, null)).toEqual(['done', 'open']);
  });
});

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
