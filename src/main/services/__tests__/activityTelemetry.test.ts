import { describe, expect, it } from 'vitest';
import { ActivityTelemetry, durationBucket } from '../activityTelemetry';
import type { ActivityInfo } from '@shared/types';

const snap = (state: ActivityInfo['state'], extra: Partial<ActivityInfo> = {}) => ({
  t1: { state, ...extra } as ActivityInfo,
});

describe('durationBucket', () => {
  it.each([
    [5_000, 'lt_10s'],
    [30_000, '10s_1m'],
    [4 * 60_000, '1m_5m'],
    [10 * 60_000, '5m_15m'],
    [40 * 60_000, '15m_1h'],
    [2 * 3_600_000, 'gt_1h'],
  ])('%i ms → %s', (ms, bucket) => {
    expect(durationBucket(ms)).toBe(bucket);
  });
});

describe('ActivityTelemetry', () => {
  it('reports a turn when work ends, with its duration bucket', () => {
    const t = new ActivityTelemetry();
    expect(t.observe(snap('busy'), 0)).toEqual([]);
    expect(t.observe(snap('busy'), 10_000)).toEqual([]);
    expect(t.observe(snap('idle'), 45_000)).toEqual([
      { event: 'turn_completed', properties: { duration_bucket: '10s_1m', interrupted: false } },
    ]);
  });

  it('marks a turn the user interrupted', () => {
    const t = new ActivityTelemetry();
    t.observe(snap('busy'), 0);
    expect(t.observe(snap('idle', { interrupted: true }), 1_000)).toEqual([
      { event: 'turn_completed', properties: { duration_bucket: 'lt_10s', interrupted: true } },
    ]);
  });

  it('counts a wait on the user inside the turn, and the turn goes on', () => {
    const t = new ActivityTelemetry();
    t.observe(snap('busy'), 0);
    expect(t.observe(snap('waiting'), 5_000)).toEqual([]);
    expect(t.observe(snap('busy'), 125_000)).toEqual([
      { event: 'wait_ended', properties: { duration_bucket: '1m_5m' } },
    ]);
    expect(t.observe(snap('idle'), 130_000)).toEqual([
      { event: 'turn_completed', properties: { duration_bucket: '1m_5m', interrupted: false } },
    ]);
  });

  it('reports a failed turn by error type (StopFailure counts)', () => {
    const t = new ActivityTelemetry();
    t.observe(snap('busy'), 0);
    expect(t.observe(snap('error', { error: { type: 'rate_limit' } }), 2_000)).toEqual([
      { event: 'turn_failed', properties: { error_type: 'rate_limit' } },
    ]);
  });

  it('says nothing for a task first seen idle, or one that goes away', () => {
    const t = new ActivityTelemetry();
    expect(t.observe(snap('idle'), 0)).toEqual([]);
    t.observe(snap('busy'), 1);
    expect(t.observe({}, 2)).toEqual([]);
    expect(t.observe(snap('idle'), 3)).toEqual([]);
  });
});
