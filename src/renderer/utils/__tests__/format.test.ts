import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatTokens,
  formatCost,
  formatDuration,
  formatResetAt,
  formatResetTime,
} from '../format';

describe('formatTokens', () => {
  it('formats <1000 as a plain integer', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(42)).toBe('42');
    expect(formatTokens(999)).toBe('999');
  });

  it('keeps one decimal below 10 of a unit, dropping a trailing .0', () => {
    expect(formatTokens(1_000)).toBe('1k');
    expect(formatTokens(1_500)).toBe('1.5k');
    expect(formatTokens(2_400_000)).toBe('2.4M');
    expect(formatTokens(1_200_000_000)).toBe('1.2B');
    expect(formatTokens(3_450_000_000_000)).toBe('3.5T');
  });

  it('rounds to whole units from 10 up', () => {
    expect(formatTokens(12_345)).toBe('12k');
    expect(formatTokens(18_000_000)).toBe('18M');
    expect(formatTokens(12_000_000_000)).toBe('12B');
    expect(formatTokens(120_400_000_000)).toBe('120B');
  });

  it('moves to the next unit when rounding reaches 1000, never 1000k', () => {
    expect(formatTokens(999.6)).toBe('1k');
    expect(formatTokens(9_960)).toBe('10k');
    expect(formatTokens(999_499)).toBe('999k');
    expect(formatTokens(999_500)).toBe('1M');
    expect(formatTokens(999_999)).toBe('1M');
    expect(formatTokens(999_999_999)).toBe('1B');
    expect(formatTokens(999_999_999_999)).toBe('1T');
  });

  it('switches from M to B at a billion', () => {
    expect(formatTokens(999_400_000)).toBe('999M');
    expect(formatTokens(1_000_000_000)).toBe('1B');
  });

  it('stays in T past a thousand trillion', () => {
    expect(formatTokens(1_500_000_000_000_000)).toBe('1500T');
  });
});

describe('formatCost', () => {
  it('formats zero as "$0.00"', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('formats small amounts to 2 decimals', () => {
    expect(formatCost(0.123)).toBe('$0.12');
    expect(formatCost(4.32)).toBe('$4.32');
    expect(formatCost(63.1)).toBe('$63.10');
  });

  it('formats >=100 without cents', () => {
    expect(formatCost(123.45)).toBe('$123');
    expect(formatCost(1500)).toBe('$1500');
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

describe('formatResetTime with an explicit now', () => {
  const now = Date.UTC(2026, 10, 24, 11, 18); // Tue 24 Nov 2026, 11:18 UTC

  it('reads the reset against the given clock, not the system one', () => {
    expect(formatResetTime(now / 1000 + 3 * 3600 + 12 * 60, now)).toBe('in 3h 12m');
    expect(formatResetTime(now / 1000 + 2 * 86400 + 4 * 3600, now)).toBe('in 2d 4h');
  });
});

describe('formatResetAt', () => {
  const utc = (h: number, m: number, dayOffset = 0) =>
    Date.UTC(2026, 10, 24 + dayOffset, h, m) / 1000; // from Tue 24 Nov 2026

  it('returns empty string for 0', () => {
    expect(formatResetAt(0)).toBe('');
  });

  it('gives the weekday, short date and time', () => {
    expect(formatResetAt(utc(14, 30), { locale: 'en-GB', timeZone: 'UTC' })).toBe(
      'Tue 24/11/2026, 14:30',
    );
    expect(formatResetAt(utc(9, 0, 2), { locale: 'en-GB', timeZone: 'UTC' })).toBe(
      'Thu 26/11/2026, 09:00',
    );
  });

  it("follows the locale's style", () => {
    expect(formatResetAt(utc(14, 30), { locale: 'en-US', timeZone: 'UTC' })).toBe(
      'Tue 11/24/26, 2:30 PM',
    );
  });

  it('reads the day in the given time zone', () => {
    // 23:30 UTC on the 24th is already the 25th in Copenhagen.
    expect(formatResetAt(utc(23, 30), { locale: 'en-GB', timeZone: 'Europe/Copenhagen' })).toBe(
      'Wed 25/11/2026, 00:30',
    );
  });
});
