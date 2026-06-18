import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatTokens,
  formatDuration,
  formatResetTime,
  formatEnergy,
  formatCarbon,
} from '../format';

describe('formatTokens', () => {
  it('returns raw number below 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with one decimal when < 10k', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(9999)).toBe('10.0k');
  });

  it('formats thousands without decimal when >= 10k', () => {
    expect(formatTokens(10000)).toBe('10k');
    expect(formatTokens(50000)).toBe('50k');
    expect(formatTokens(999999)).toBe('1000k');
  });

  it('formats millions', () => {
    expect(formatTokens(1000000)).toBe('1.0m');
    expect(formatTokens(1500000)).toBe('1.5m');
    expect(formatTokens(2345678)).toBe('2.3m');
  });
});

describe('formatEnergy', () => {
  it('formats kWh at/above 1000 Wh', () => {
    expect(formatEnergy(1000)).toBe('1.0 kWh');
    expect(formatEnergy(1500)).toBe('1.5 kWh');
  });

  it('formats whole Wh between 1 and 1000', () => {
    expect(formatEnergy(1)).toBe('1 Wh');
    expect(formatEnergy(50)).toBe('50 Wh');
    expect(formatEnergy(999)).toBe('999 Wh');
  });

  it('formats sub-Wh values to two decimals', () => {
    expect(formatEnergy(0.5)).toBe('0.50 Wh');
    expect(formatEnergy(0.005)).toBe('0.01 Wh'); // rounds up
  });

  it('guards zero and negatives', () => {
    expect(formatEnergy(0)).toBe('0 Wh');
    expect(formatEnergy(-3)).toBe('0 Wh');
  });
});

describe('formatCarbon', () => {
  it('formats kg at/above 1000 g', () => {
    expect(formatCarbon(1000)).toBe('1.0 kg');
    expect(formatCarbon(1500)).toBe('1.5 kg');
  });

  it('formats whole grams between 1 and 1000', () => {
    expect(formatCarbon(12)).toBe('12 g');
    // 999.9 rounds to "1000" but stays in grams (below the 1000 kg threshold).
    expect(formatCarbon(999.9)).toBe('1000 g');
  });

  it('formats sub-gram values to one decimal', () => {
    expect(formatCarbon(0.5)).toBe('0.5 g');
    expect(formatCarbon(0.04)).toBe('0.0 g');
  });

  it('guards zero and negatives', () => {
    expect(formatCarbon(0)).toBe('0 g');
    expect(formatCarbon(-2)).toBe('0 g');
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(7261000)).toBe('2h 1m');
  });
});

describe('formatResetTime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string for 0', () => {
    expect(formatResetTime(0)).toBe('');
  });

  it('returns "now" for past timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000000000000);
    expect(formatResetTime(1000000000)).toBe('now');
  });

  it('formats minutes for < 60 min', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    // 30 minutes from now in epoch seconds
    const future = now / 1000 + 30 * 60;
    expect(formatResetTime(future)).toBe('in 30m');
  });

  it('formats hours and minutes for < 24 hours', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const future = now / 1000 + 2 * 3600 + 15 * 60;
    expect(formatResetTime(future)).toBe('in 2h 15m');
  });

  it('formats days and hours for >= 24 hours', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const future = now / 1000 + 2 * 86400 + 3 * 3600;
    expect(formatResetTime(future)).toBe('in 2d 3h');
  });

  it('formats days without hours when remainder is 0', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const future = now / 1000 + 3 * 86400;
    expect(formatResetTime(future)).toBe('in 3d');
  });
});
