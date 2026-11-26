import { describe, expect, it } from 'vitest';
import { ActivityTelemetry, sessionCounts } from '../activityTelemetry';
import type { ActivityInfo } from '@shared/types';

const snap = (state: ActivityInfo['state'], extra: Partial<ActivityInfo> = {}) => ({
  t1: { state, ...extra } as ActivityInfo,
});

const turn = (duration_bucket: string, extra: Record<string, unknown> = {}) => ({
  event: 'turn_completed',
  properties: {
    duration_bucket,
    interrupted: false,
    tool_call_bucket: '0',
    subagent_used: false,
    ...extra,
  },
});

describe('ActivityTelemetry', () => {
  it('reports a turn when work ends, with its duration bucket', () => {
    const t = new ActivityTelemetry();
    expect(t.observe(snap('busy'), 0)).toEqual([]);
    expect(t.observe(snap('busy'), 10_000)).toEqual([]);
    expect(t.observe(snap('idle'), 45_000)).toEqual([turn('10s_1m')]);
  });

  it('marks a turn the user interrupted', () => {
    const t = new ActivityTelemetry();
    t.observe(snap('busy'), 0);
    expect(t.observe(snap('idle', { interrupted: true }), 1_000)).toEqual([
      turn('lt_10s', { interrupted: true }),
    ]);
  });

  it('counts a wait on the user inside the turn, and the turn goes on', () => {
    const t = new ActivityTelemetry();
    t.observe(snap('busy'), 0);
    t.noteWait('t1', 'permission');
    expect(t.observe(snap('waiting'), 5_000)).toEqual([]);
    expect(t.observe(snap('busy'), 125_000)).toEqual([
      { event: 'wait_ended', properties: { duration_bucket: '1m_5m', kind: 'permission' } },
    ]);
    expect(t.observe(snap('idle'), 130_000)).toEqual([turn('1m_5m')]);
  });

  it('keeps the kind of the hook that opened the wait, not a later alert', () => {
    const t = new ActivityTelemetry();
    t.observe(snap('busy'), 0);
    t.noteWait('t1', 'elicitation');
    t.observe(snap('waiting'), 1_000);
    // The Notification alert ~6 s in names the same wait again.
    t.noteWait('t1', 'permission');
    expect(t.observe(snap('busy'), 2_000)).toEqual([
      { event: 'wait_ended', properties: { duration_bucket: 'lt_10s', kind: 'elicitation' } },
    ]);
    // The next wait starts clean.
    t.observe(snap('waiting'), 3_000);
    expect(t.observe(snap('busy'), 4_000)).toEqual([
      { event: 'wait_ended', properties: { duration_bucket: 'lt_10s', kind: 'unknown' } },
    ]);
  });

  it('counts the tool calls and subagents of a turn, then starts the next at zero', () => {
    const t = new ActivityTelemetry();
    t.observe(snap('busy'), 0);
    for (let i = 0; i < 7; i++) t.noteToolCall('t1');
    t.noteSubagent('t1');
    expect(t.observe(snap('idle'), 1_000)).toEqual([
      turn('lt_10s', { tool_call_bucket: '6_10', subagent_used: true }),
    ]);
    t.observe(snap('busy'), 2_000);
    t.noteToolCall('t1');
    expect(t.observe(snap('idle'), 3_000)).toEqual([turn('lt_10s', { tool_call_bucket: '1' })]);
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

  it('times a new task to its first turn, once', () => {
    const t = new ActivityTelemetry();
    t.noteTaskCreated('t1', 0);
    expect(t.observe(snap('idle'), 1_000)).toEqual([]);
    expect(t.observe(snap('busy'), 90_000)).toEqual([
      { event: 'first_turn_started', properties: { duration_bucket: '1m_5m' } },
    ]);
    t.observe(snap('idle'), 95_000);
    expect(t.observe(snap('busy'), 96_000)).toEqual([]);
  });

  it('times a task first seen already busy (its prompt went with the dispatch)', () => {
    const t = new ActivityTelemetry();
    t.noteTaskCreated('t1', 0);
    expect(t.observe(snap('busy'), 4_000)).toEqual([
      { event: 'first_turn_started', properties: { duration_bucket: 'lt_10s' } },
    ]);
  });
});

describe('sessionCounts', () => {
  it('counts live sessions (not asleep) and the busy ones among them', () => {
    const all = {
      a: { state: 'busy' },
      b: { state: 'waiting' },
      c: { state: 'idle' },
      d: { state: 'stopped' },
      e: { state: 'busy' },
    } as Record<string, ActivityInfo>;
    expect(sessionCounts(all)).toEqual({ live: 4, busy: 2 });
  });
});
