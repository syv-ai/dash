import { describe, expect, it } from 'vitest';
import { ErrorThrottle } from '../errorThrottle';

describe('ErrorThrottle', () => {
  it('lets a key through once per window', () => {
    const t = new ErrorThrottle({ windowMs: 1_000, maxPerHour: 100 });
    expect(t.allow('a', 0)).toBe(true);
    expect(t.allow('a', 500)).toBe(false);
    expect(t.allow('b', 500)).toBe(true);
    expect(t.allow('a', 1_000)).toBe(true);
  });

  it('caps all keys per hour, and opens again the next hour', () => {
    const t = new ErrorThrottle({ windowMs: 1, maxPerHour: 2 });
    expect(t.allow('a', 0)).toBe(true);
    expect(t.allow('b', 0)).toBe(true);
    expect(t.allow('c', 0)).toBe(false);
    expect(t.allow('c', 3_600_000)).toBe(true);
  });
});
