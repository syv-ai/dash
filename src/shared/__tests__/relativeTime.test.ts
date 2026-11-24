import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatTimeAgo } from '../relativeTime';

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

describe('formatTimeAgo', () => {
  it('speaks each bucket', () => {
    expect(formatTimeAgo(0, NOW)).toBe('');
    expect(formatTimeAgo(NOW - 20, NOW)).toBe('just now');
    expect(formatTimeAgo(NOW + 20, NOW)).toBe('just now');
    expect(formatTimeAgo(NOW - 4 * 60, NOW)).toBe('4 min ago');
    expect(formatTimeAgo(NOW - 2 * 3600, NOW)).toBe('2 hr ago');
    expect(formatTimeAgo(NOW - 86400, NOW)).toBe('1 day ago');
    expect(formatTimeAgo(NOW - 3 * 86400, NOW)).toBe('3 days ago');
    expect(formatTimeAgo(NOW - 5 * 30 * 86400, NOW)).toBe('5 mo ago');
    expect(formatTimeAgo(NOW - 2 * 365 * 86400, NOW)).toBe('2 yr ago');
  });
});
