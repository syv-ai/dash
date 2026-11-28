import { describe, expect, it } from 'vitest';
import {
  clearLimit,
  hitLimit,
  inferLimitHit,
  limitExpired,
  limitNotice,
  NO_LIMIT,
} from '../usageLimitState';

const NOW = 1_800_000_000_000;
const SOON = NOW / 1000 + 3600;
const LIMITS = {
  fiveHour: { usedPercentage: 97, resetsAt: SOON },
  sevenDay: { usedPercentage: 40, resetsAt: SOON + 86_400 * 3 },
};

describe('inferLimitHit', () => {
  it('takes the window the text names, with its reset time', () => {
    const text = "You've hit your 5-hour limit · resets 8:40pm (Europe/Copenhagen)";
    expect(inferLimitHit(text, LIMITS, NOW)).toEqual({ limit: 'fiveHour', resetsAt: SOON });
    expect(inferLimitHit("You've hit your weekly limit", LIMITS, NOW)).toEqual({
      limit: 'sevenDay',
      resetsAt: SOON + 86_400 * 3,
    });
  });

  it('falls back on the window nearest full, from 90%', () => {
    expect(inferLimitHit('API Error: Rate limit reached', LIMITS, NOW).limit).toBe('fiveHour');
    const low = { fiveHour: { usedPercentage: 60, resetsAt: SOON } };
    expect(inferLimitHit('API Error: Rate limit reached', low, NOW)).toEqual({
      limit: null,
      resetsAt: 0,
    });
  });

  it('is unknown with no text and no limits, and drops a reset already past', () => {
    expect(inferLimitHit(undefined, undefined, NOW)).toEqual({ limit: null, resetsAt: 0 });
    const past = { fiveHour: { usedPercentage: 99, resetsAt: NOW / 1000 - 1 } };
    expect(inferLimitHit(undefined, past, NOW)).toEqual({ limit: 'fiveHour', resetsAt: 0 });
  });
});

describe('the limit state', () => {
  const five = { limit: 'fiveHour' as const, resetsAt: SOON };

  it('notifies once for a hit however many tasks hit it', () => {
    const a = hitLimit(NO_LIMIT, 't1', five, NOW);
    const b = hitLimit(a.state, 't2', five, NOW + 5);
    const c = hitLimit(b.state, 't1', five, NOW + 9);
    expect([a.notify, b.notify, c.notify]).toEqual([true, false, false]);
    expect(c.state.hit).toEqual({ ...five, hitAt: NOW });
    expect([...c.state.tasks]).toEqual(['t1', 't2']);
  });

  it('notifies again for a different window, and learns a reset time it lacked', () => {
    const a = hitLimit(NO_LIMIT, 't1', { limit: 'fiveHour', resetsAt: 0 }, NOW);
    const b = hitLimit(a.state, 't2', five, NOW);
    expect(b.notify).toBe(false);
    expect(b.state.hit?.resetsAt).toBe(SOON);
    expect(hitLimit(b.state, 't3', { limit: 'sevenDay', resetsAt: SOON }, NOW).notify).toBe(true);
  });

  it('clears to no limit and hands back the tasks to put back', () => {
    const s = hitLimit(hitLimit(NO_LIMIT, 't1', five, NOW).state, 't2', five, NOW).state;
    expect(clearLimit(s)).toEqual({ state: NO_LIMIT, revert: ['t1', 't2'] });
    expect(hitLimit(NO_LIMIT, 't1', five, NOW).notify).toBe(true);
  });

  it('expires at the reset time, never without one', () => {
    const s = hitLimit(NO_LIMIT, 't1', five, NOW).state;
    expect(limitExpired(s, NOW)).toBe(false);
    expect(limitExpired(s, SOON * 1000)).toBe(true);
    const unknown = hitLimit(NO_LIMIT, 't1', { limit: null, resetsAt: 0 }, NOW).state;
    expect(limitExpired(unknown, NOW * 2)).toBe(false);
  });
});

describe('limitNotice', () => {
  const clock = { locale: 'en-GB', timeZone: 'UTC' };
  it('names the window and its reset clock time', () => {
    const at = Date.UTC(2026, 10, 28, 20, 40) / 1000;
    const now = at * 1000 - 3_600_000;
    expect(limitNotice({ limit: 'fiveHour', resetsAt: at, hitAt: now }, now, clock)).toEqual({
      title: '5-hour limit reached',
      body: 'Resets at 20:40',
    });
    expect(
      limitNotice({ limit: 'sevenDay', resetsAt: at, hitAt: 0 }, now - 3 * 86_400_000, clock).body,
    ).toBe('Resets at Sat 20:40');
    expect(limitNotice({ limit: null, resetsAt: 0, hitAt: now }, now, clock).title).toBe(
      'Usage limit reached',
    );
  });
});
