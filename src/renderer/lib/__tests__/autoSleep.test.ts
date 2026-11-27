import { describe, expect, it } from 'vitest';
import type { ActivityInfo } from '@shared/types';
import {
  autoSleepAfterMs,
  checkEveryMs,
  dueForSleep,
  restingTaskIds,
  trackRest,
  type RestInputs,
} from '../autoSleep';

const HOUR = 3_600_000;
const none = new Set<string>();

function inputs(activity: Record<string, ActivityInfo>, over: Partial<RestInputs> = {}) {
  return {
    activity,
    activeTaskId: null,
    unseen: none,
    protectedIds: none,
    remoteControlIds: none,
    ...over,
  };
}

describe('restingTaskIds', () => {
  it('takes only seen, idle sessions that are not on screen', () => {
    const activity: Record<string, ActivityInfo> = {
      rested: { state: 'idle' },
      working: { state: 'busy' },
      needs: { state: 'waiting' },
      failed: { state: 'error' },
      asleep: { state: 'stopped' },
      compacting: { state: 'idle', compacting: true },
      unseen: { state: 'idle' },
      onScreen: { state: 'idle' },
    };
    const got = restingTaskIds(
      inputs(activity, { activeTaskId: 'onScreen', unseen: new Set(['unseen']) }),
    );
    expect(got).toEqual(['rested']);
  });

  it('leaves protected and remote-controlled tasks awake', () => {
    const activity: Record<string, ActivityInfo> = {
      a: { state: 'idle' },
      kept: { state: 'idle' },
      remote: { state: 'idle' },
    };
    const got = restingTaskIds(
      inputs(activity, { protectedIds: new Set(['kept']), remoteControlIds: new Set(['remote']) }),
    );
    expect(got).toEqual(['a']);
  });
});

describe('trackRest', () => {
  it('keeps a running clock, starts a new one now, and drops tasks no longer at rest', () => {
    const prev = new Map([
      ['still', 100],
      ['woke', 100],
    ]);
    const next = trackRest(prev, ['still', 'new'], 500);
    expect([...next]).toEqual([
      ['still', 100],
      ['new', 500],
    ]);
  });

  it('restarts the clock of a task that left rest and came back', () => {
    const left = trackRest(new Map([['t', 100]]), [], 200);
    expect(trackRest(left, ['t'], 300).get('t')).toBe(300);
  });
});

describe('dueForSleep', () => {
  it('takes tasks rested for the duration or longer', () => {
    const since = new Map([
      ['long', 0],
      ['exact', HOUR],
      ['short', HOUR + 1],
    ]);
    expect(dueForSleep(since, 2 * HOUR, HOUR)).toEqual(['long', 'exact']);
  });
});

describe('autoSleepAfterMs', () => {
  it('is null when off, even with a dev override', () => {
    expect(autoSleepAfterMs('off')).toBeNull();
    expect(autoSleepAfterMs('off', '5000')).toBeNull();
  });

  it('maps each choice to hours, and a valid dev override replaces it', () => {
    expect(autoSleepAfterMs('1h')).toBe(HOUR);
    expect(autoSleepAfterMs('8h')).toBe(8 * HOUR);
    expect(autoSleepAfterMs('2h', '5000')).toBe(5000);
    expect(autoSleepAfterMs('2h', 'nope')).toBe(2 * HOUR);
    expect(autoSleepAfterMs('2h', '-1')).toBe(2 * HOUR);
  });
});

describe('checkEveryMs', () => {
  it('checks once a minute, or a quarter of a short duration, never under a second', () => {
    expect(checkEveryMs(HOUR)).toBe(60_000);
    expect(checkEveryMs(20_000)).toBe(5_000);
    expect(checkEveryMs(1_000)).toBe(1_000);
  });
});
