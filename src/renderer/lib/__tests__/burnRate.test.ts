import { describe, it, expect } from 'vitest';
import {
  BURN_WINDOW_MS,
  burnOutlook,
  CLOSE_AT_PCT,
  formatPace,
  formatProjection,
  formatRate,
  LIMIT_WINDOW_MS,
  MIN_ELAPSED_MS,
  pressingBurn,
  limitBurns,
  projectAverage,
  ratePerHour,
  recordLimits,
  recordSample,
  type LimitHistory,
  type Projection,
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

describe('projectAverage', () => {
  const WEEK = LIMIT_WINDOW_MS.sevenDay;
  /** A weekly window `usedPercentage` in, resetting `resetsInH` hours after T0. */
  const weekly = (usedPercentage: number, resetsInH: number) =>
    projectAverage({ usedPercentage, resetsAt: T0 / 1000 + resetsInH * 3600 }, T0, WEEK);

  it('carries the average pace so far on to the reset', () => {
    // 56 % used, resets in 68 h, so 100 h gone: 0.56 %/h, ~94 % at the reset.
    const p = weekly(56, 68);
    expect(p).toEqual({
      perHour: expect.closeTo(0.56),
      toLimitMs: null,
      resetsInMs: 68 * HOUR,
      atResetPct: expect.closeTo(94.08),
    });
    expect(burnOutlook(p!)).toBe('close');
  });

  it('gives the time to 100 % when the limit comes before the reset', () => {
    // 5-hour window, 2 h gone with 80 % used: 40 %/h, 20 points left → 30 min.
    const p = projectAverage(
      { usedPercentage: 80, resetsAt: T0 / 1000 + 3 * 3600 },
      T0,
      LIMIT_WINDOW_MS.fiveHour,
    );
    expect(p?.toLimitMs).toBeCloseTo(30 * MIN);
    expect(p?.atResetPct).toBeCloseTo(200);
  });

  it('reads an idle window as a pace of 0', () => {
    expect(weekly(0, 100)).toMatchObject({ perHour: 0, toLimitMs: null, atResetPct: 0 });
  });

  it('needs MIN_ELAPSED_MS of the window gone', () => {
    const justIn = (WEEK - MIN_ELAPSED_MS) / HOUR;
    expect(weekly(1, justIn)).not.toBeNull();
    expect(weekly(1, justIn + 1 / 60)).toBeNull();
    // A reset further off than the window is long: none of it gone.
    expect(weekly(1, WEEK / HOUR + 1)).toBeNull();
  });

  it('is null without a reset time', () => {
    expect(projectAverage({ usedPercentage: 40, resetsAt: 0 }, T0, WEEK)).toBeNull();
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
  it('reads each reported limit as of its latest reading, barometer and projection apart', () => {
    const histories = { fiveHour: history([10, 12, 14], 10 * MIN) };
    const burns = limitBurns(histories, {
      fiveHour: { usedPercentage: 14, resetsAt: RESETS },
      sevenDay: { usedPercentage: 3, resetsAt: RESETS },
    });
    expect(burns.fiveHour?.perHour).toBeCloseTo(12);
    // Resets 5 h after T0, read at T0 + 20 min: 20 min of the window gone.
    expect(burns.fiveHour?.projection?.perHour).toBeCloseTo(14 / (20 / 60));
    expect(burns.sevenDay).toEqual({ perHour: null, projection: null });
  });

  it('looks back 30 minutes on the 5-hour limit and an hour on the weekly', () => {
    expect(BURN_WINDOW_MS).toEqual({ fiveHour: 30 * MIN, sevenDay: HOUR });
  });

  it('leaves out a barometer that is not rising, keeping the projection', () => {
    const histories = { fiveHour: history([20, 20, 20], 10 * MIN) };
    const burns = limitBurns(histories, { fiveHour: { usedPercentage: 20, resetsAt: RESETS } });
    expect(burns.fiveHour?.perHour).toBeNull();
    expect(burns.fiveHour?.projection).not.toBeNull();
  });
});

describe('pressingBurn', () => {
  const projection = (toLimitMs: number | null, atResetPct = 50): Projection => ({
    perHour: 1,
    toLimitMs,
    resetsInMs: HOUR,
    atResetPct,
  });
  const burn = (perHour: number | null, p: Projection | null) => ({ perHour, projection: p });

  it('is null when no limit has a barometer reading', () => {
    expect(pressingBurn({})).toBeNull();
    expect(pressingBurn({ fiveHour: burn(null, projection(HOUR)) })).toBeNull();
  });

  it('picks the limit its average pace takes to 100 % soonest, showing its barometer', () => {
    const got = pressingBurn({
      fiveHour: burn(10, projection(5 * HOUR)),
      sevenDay: burn(1, projection(2 * HOUR)),
    });
    expect(got).toEqual({ limit: 'sevenDay', perHour: 1, projection: projection(2 * HOUR) });
  });

  it('prefers a limit that will be reached over one that resets first', () => {
    const got = pressingBurn({
      fiveHour: burn(30, projection(null)),
      sevenDay: burn(1, projection(40 * HOUR)),
    });
    expect(got?.limit).toBe('sevenDay');
  });

  it('picks the one that comes closest to its limit when both reset first', () => {
    const got = pressingBurn({
      fiveHour: burn(9, projection(null, 60)),
      sevenDay: burn(0.5, projection(null, 92)),
    });
    expect(got?.limit).toBe('sevenDay');
  });

  it('ranks a limit with no projection yet last', () => {
    const got = pressingBurn({ fiveHour: burn(9, null), sevenDay: burn(0.5, projection(null)) });
    expect(got?.limit).toBe('sevenDay');
    expect(pressingBurn({ fiveHour: burn(9, null) })?.projection).toBeNull();
  });
});

describe('burnOutlook', () => {
  const at = (atResetPct: number) => burnOutlook({ atResetPct });

  it('is clear while the window would reset below the close mark', () => {
    expect(at(0)).toBe('clear');
    expect(at(CLOSE_AT_PCT - 0.01)).toBe('clear');
  });

  it('is close from the mark up to exactly 100 % at the reset', () => {
    expect(at(CLOSE_AT_PCT)).toBe('close');
    expect(at(100)).toBe('close');
  });

  it('is over once the limit comes before the reset', () => {
    expect(at(100.01)).toBe('over');
    expect(at(Infinity)).toBe('over');
  });
});

describe('formatting', () => {
  it('shows small rates with one decimal and larger ones whole', () => {
    expect(formatRate(0.44)).toBe('+0.4%/h');
    expect(formatRate(6.04)).toBe('+6%/h');
    expect(formatRate(12.6)).toBe('+13%/h');
  });

  it('shows an average pace unsigned, to two places under 1', () => {
    expect(formatPace(0.56)).toBe('0.56%/h');
    expect(formatPace(0.5)).toBe('0.5%/h');
    expect(formatPace(2.54)).toBe('2.5%/h');
    expect(formatPace(12.6)).toBe('13%/h');
  });

  it('says where the average pace leads, and the time to the reset', () => {
    const clear = { perHour: 0.56, toLimitMs: null, resetsInMs: 68 * HOUR, atResetPct: 94.08 };
    expect(formatProjection(clear)).toBe('0.56%/h → ~94% at reset; TTR 2d 20h');
    const over = {
      perHour: 12,
      toLimitMs: 2 * HOUR + 10 * MIN,
      resetsInMs: 3 * HOUR + 44 * MIN,
      atResetPct: 130,
    };
    expect(formatProjection(over)).toBe('12%/h → 100% in 2h 10m; TTR 3h 44m');
  });
});
