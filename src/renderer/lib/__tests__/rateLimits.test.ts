import { describe, it, expect } from 'vitest';
import type { RateLimits, StatusLineData } from '../../../shared/types';
import { mergeRateLimits } from '../rateLimits';

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
