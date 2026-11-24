import { describe, it, expect } from 'vitest';
import {
  BURN_WINDOW_MS,
  burnFor,
  formatEta,
  formatRate,
  pressingBurn,
  limitBurns,
  ratePerHour,
  recordLimits,
  recordSample,
  type LimitHistory,
} from '../burnRate';

const MIN = 60_000;
const HOUR = 60 * MIN;
const WINDOW = 30 * MIN;
const T0 = 1_800_000_000_000;
/** Resets 5 h after T0, in epoch seconds. */
const RESETS = T0 / 1000 + 5 * 3600;

/** Readings of `pcts` taken every `stepMs` from T0. */
function history(pcts: number[], stepMs: number, resetsAt = RESETS): LimitHistory {
  let h: LimitHistory | undefined;
  pcts.forEach((pct, i) => {
    h = recordSample(h, { usedPercentage: pct, resetsAt }, T0 + i * stepMs, WINDOW);
  });
  return h!;
}

describe('recordSample', () => {
  it('starts over when the window resets', () => {
    const h = recordSample(
      history([10, 20], 10 * MIN),
      { usedPercentage: 30, resetsAt: RESETS + 5 * 3600 },
      T0 + 20 * MIN,
      WINDOW,
    );
    expect(h.samples).toEqual([{ at: T0 + 20 * MIN, pct: 30 }]);
  });

  it('keeps the window when sessions report a reset time a few seconds apart', () => {
    const h = recordSample(
      history([10], MIN),
      { usedPercentage: 12, resetsAt: RESETS + 2 },
      T0 + 10 * MIN,
      WINDOW,
    );
    expect(h.samples).toHaveLength(2);
  });

  it('starts over when the % drops', () => {
    expect(history([40, 41, 3], 10 * MIN).samples).toEqual([{ at: T0 + 20 * MIN, pct: 3 }]);
  });

  it('drops readings older than the window', () => {
    const h = history([1, 2, 3, 4, 5], 10 * MIN);
    expect(h.samples.map((s) => s.pct)).toEqual([2, 3, 4, 5]);
  });

  it('thins readings that arrive close together, keeping the first and the latest', () => {
    const h = history([1, 1, 1, 2, 2, 2, 3], 5_000);
    expect(h.samples[0]).toEqual({ at: T0, pct: 1 });
    expect(h.samples.at(-1)).toEqual({ at: T0 + 30_000, pct: 3 });
    expect(h.samples.length).toBeLessThan(7);
  });
});

describe('ratePerHour', () => {
  it('is the change per hour between the first and last readings in the window', () => {
    expect(ratePerHour(history([10, 11, 13], 10 * MIN), T0 + 20 * MIN, WINDOW)).toBeCloseTo(9);
  });

  it('needs two readings at least 5 minutes apart', () => {
    expect(ratePerHour(history([10], MIN), T0, WINDOW)).toBeNull();
    expect(ratePerHour(history([10, 12], 4 * MIN), T0 + 4 * MIN, WINDOW)).toBeNull();
    expect(ratePerHour(history([10, 12], 5 * MIN), T0 + 5 * MIN, WINDOW)).toBeCloseTo(24);
  });

  it('ignores readings that have aged out of the window since', () => {
    expect(ratePerHour(history([10, 12], 10 * MIN), T0 + 45 * MIN, WINDOW)).toBeNull();
  });
});

describe('burnFor', () => {
  it('projects the time to 100 % at the current rate', () => {
    // 40 → 46 over an hour: 6 %/h, 54 points left → 9 h. Resets in 20 h.
    const resetsAt = T0 / 1000 + 20 * 3600;
    const h = history([40, 43, 46], 30 * MIN, resetsAt);
    const burn = burnFor(h, { usedPercentage: 46, resetsAt }, T0 + HOUR, 2 * HOUR);
    expect(burn?.perHour).toBeCloseTo(6);
    expect(burn?.toLimitMs).toBeCloseTo(9 * HOUR);
  });

  it('says the window resets first when the limit lies beyond the reset', () => {
    // 6 %/h with 54 points left is 9 h; the window resets in 5 h.
    const h = history([40, 43, 46], 30 * MIN);
    const burn = burnFor(h, { usedPercentage: 46, resetsAt: RESETS }, T0 + HOUR, 2 * HOUR);
    expect(burn).toEqual({ perHour: expect.closeTo(6), toLimitMs: null });
  });

  it('is null while the % holds still or without enough data', () => {
    const flat = history([20, 20, 20], 10 * MIN);
    expect(burnFor(flat, { usedPercentage: 20, resetsAt: RESETS }, T0 + 20 * MIN, WINDOW)).toBe(
      null,
    );
    const one = history([20], MIN);
    expect(burnFor(one, { usedPercentage: 20, resetsAt: RESETS }, T0, WINDOW)).toBeNull();
  });
});

describe('recordLimits', () => {
  it('records each reported limit over its own window and keeps the others', () => {
    const first = recordLimits(
      {},
      {
        fiveHour: { usedPercentage: 1, resetsAt: RESETS },
        sevenDay: { usedPercentage: 5, resetsAt: RESETS },
      },
      T0,
    );
    const later = T0 + BURN_WINDOW_MS.fiveHour + MIN;
    const next = recordLimits(first, { fiveHour: { usedPercentage: 2, resetsAt: RESETS } }, later);
    // The 5-hour reading at T0 aged out of its 30-minute window; weekly is untouched.
    expect(next.fiveHour?.samples.map((s) => s.pct)).toEqual([2]);
    expect(next.sevenDay).toBe(first.sevenDay);
  });
});

describe('limitBurns', () => {
  it('measures each reported limit as of its latest reading', () => {
    const histories = { fiveHour: history([10, 12, 14], 10 * MIN) };
    const burns = limitBurns(histories, {
      fiveHour: { usedPercentage: 14, resetsAt: RESETS },
      sevenDay: { usedPercentage: 3, resetsAt: RESETS },
    });
    expect(burns.fiveHour?.perHour).toBeCloseTo(12);
    expect(burns.sevenDay).toBeNull();
  });
});

describe('pressingBurn', () => {
  const burn = (perHour: number, toLimitMs: number | null) => ({ perHour, toLimitMs });

  it('is null when no limit is burning', () => {
    expect(pressingBurn({})).toBeNull();
    expect(pressingBurn({ fiveHour: null, sevenDay: null })).toBeNull();
  });

  it('picks the limit reached soonest', () => {
    const got = pressingBurn({ fiveHour: burn(10, 5 * HOUR), sevenDay: burn(1, 2 * HOUR) });
    expect(got?.limit).toBe('sevenDay');
  });

  it('prefers a limit that will be reached over one that resets first', () => {
    const got = pressingBurn({ fiveHour: burn(30, null), sevenDay: burn(1, 40 * HOUR) });
    expect(got?.limit).toBe('sevenDay');
  });

  it('falls back to the faster rate when both reset first', () => {
    const got = pressingBurn({ fiveHour: burn(2, null), sevenDay: burn(0.5, null) });
    expect(got?.limit).toBe('fiveHour');
  });
});

describe('formatting', () => {
  it('shows small rates with one decimal and larger ones whole', () => {
    expect(formatRate(0.44)).toBe('+0.4%/h');
    expect(formatRate(6.04)).toBe('+6%/h');
    expect(formatRate(12.6)).toBe('+13%/h');
  });

  it('rounds the time to the limit to minutes, hours or days', () => {
    expect(formatEta(40 * MIN)).toBe('~40m');
    expect(formatEta(9 * HOUR + 10 * MIN)).toBe('~9h');
    expect(formatEta(80 * HOUR)).toBe('~3d');
  });
});
