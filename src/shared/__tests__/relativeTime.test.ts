import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../relativeTime';

const NOW = 1_700_000_000;

describe('formatRelativeTime', () => {
  it('returns empty string for a falsy timestamp', () => {
    expect(formatRelativeTime(0, NOW)).toBe('');
  });

  it('formats each magnitude bucket', () => {
    expect(formatRelativeTime(NOW - 45, NOW)).toBe('45s');
    expect(formatRelativeTime(NOW - 12 * 60, NOW)).toBe('12m');
    expect(formatRelativeTime(NOW - 3 * 3600, NOW)).toBe('3h');
    expect(formatRelativeTime(NOW - 5 * 86400, NOW)).toBe('5d');
    expect(formatRelativeTime(NOW - 8 * 30 * 86400, NOW)).toBe('8mo');
    expect(formatRelativeTime(NOW - 2 * 365 * 86400, NOW)).toBe('2y');
  });

  it('clamps future timestamps to 0s', () => {
    expect(formatRelativeTime(NOW + 100, NOW)).toBe('0s');
  });
});
