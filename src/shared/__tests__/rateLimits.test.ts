import { describe, it, expect } from 'vitest';
import type { RateLimits, StatusLineData } from '../types';
import { mergeRateLimits, nearestLimit, withLimitHit } from '../rateLimits';

const NOW = 1_800_000_000_000;
const inHours = (h: number) => NOW / 1000 + h * 3600;

function session(updatedAt: number, rateLimits?: RateLimits): StatusLineData {
  return { contextUsage: { used: 0, total: 0, percentage: 0 }, rateLimits, updatedAt };
}

describe('mergeRateLimits', () => {
  it('keeps the 5-hour limit when the newest report carries only a stale weekly one', () => {
    // As captured from a real launch: a session resumed at startup, before
    // its first request, reports the weekly window alone at an old value,
    // a few ms after the working session's full report.
    const merged = mergeRateLimits(
      {
        working: session(NOW - 27, {
          fiveHour: { usedPercentage: 5, resetsAt: inHours(4) },
          sevenDay: { usedPercentage: 37, resetsAt: inHours(90) },
        }),
        resumed: session(NOW, { sevenDay: { usedPercentage: 25, resetsAt: inHours(90) } }),
      },
      NOW,
    );
    expect(merged).toEqual({
      fiveHour: { usedPercentage: 5, resetsAt: inHours(4) },
      sevenDay: { usedPercentage: 37, resetsAt: inHours(90) },
    });
  });

  it('takes the highest reading within one window, its reset times a little apart', () => {
    const merged = mergeRateLimits(
      {
        a: session(NOW, { fiveHour: { usedPercentage: 10, resetsAt: inHours(4) } }),
        b: session(NOW - 5_000, { fiveHour: { usedPercentage: 12, resetsAt: inHours(4) + 20 } }),
      },
      NOW,
    );
    expect(merged?.fiveHour?.usedPercentage).toBe(12);
  });

  it('takes a later window over a fuller earlier one', () => {
    const merged = mergeRateLimits(
      {
        old: session(NOW, { fiveHour: { usedPercentage: 90, resetsAt: inHours(0.5) } }),
        next: session(NOW - 5_000, { fiveHour: { usedPercentage: 2, resetsAt: inHours(4.5) } }),
      },
      NOW,
    );
    expect(merged?.fiveHour).toEqual({ usedPercentage: 2, resetsAt: inHours(4.5) });
  });

  it('drops a window whose reset time has passed', () => {
    const merged = mergeRateLimits(
      {
        stale: session(NOW, {
          fiveHour: { usedPercentage: 80, resetsAt: inHours(-1) },
          sevenDay: { usedPercentage: 40, resetsAt: inHours(90) },
        }),
      },
      NOW,
    );
    expect(merged).toEqual({ sevenDay: { usedPercentage: 40, resetsAt: inHours(90) } });
  });

  it('treats an unknown reset time as a running window', () => {
    const merged = mergeRateLimits(
      { a: session(NOW, { fiveHour: { usedPercentage: 3, resetsAt: 0 } }) },
      NOW,
    );
    expect(merged?.fiveHour?.usedPercentage).toBe(3);
  });

  it('is undefined when no session reports a limit', () => {
    expect(mergeRateLimits({ a: session(NOW) }, NOW)).toBeUndefined();
    expect(mergeRateLimits({}, NOW)).toBeUndefined();
  });
});

describe('withLimitHit', () => {
  const at = NOW / 1000 + 600;
  const limits: RateLimits = { fiveHour: { usedPercentage: 97, resetsAt: at } };

  it('shows the hit window full, flagged reached, with its reset time', () => {
    expect(withLimitHit(limits, { limit: 'fiveHour', resetsAt: 0, hitAt: NOW }, NOW)).toEqual({
      fiveHour: { usedPercentage: 100, resetsAt: at, reached: true },
    });
  });

  it('changes nothing for an unknown window or once the reset passed', () => {
    expect(withLimitHit(limits, { limit: null, resetsAt: 0, hitAt: NOW }, NOW)).toBe(limits);
    expect(withLimitHit(limits, null, NOW)).toBe(limits);
    const hit = { limit: 'fiveHour' as const, resetsAt: at, hitAt: NOW };
    expect(withLimitHit(limits, hit, at * 1000)).toBe(limits);
  });
});

describe('nearestLimit', () => {
  it('is the window closest to full from 90%, else null', () => {
    expect(
      nearestLimit({
        fiveHour: { usedPercentage: 91, resetsAt: 1 },
        sevenDay: { usedPercentage: 95, resetsAt: 2 },
      }),
    ).toBe('sevenDay');
    expect(nearestLimit({ fiveHour: { usedPercentage: 89, resetsAt: 1 } })).toBeNull();
    expect(nearestLimit(undefined)).toBeNull();
  });
});
