import { describe, it, expect } from 'vitest';
import { usageTier } from '../usageTier';

describe('usageTier', () => {
  it('returns "good" when percentage is below 60', () => {
    expect(usageTier(0)).toBe('good');
    expect(usageTier(38)).toBe('good');
    expect(usageTier(59.9)).toBe('good');
  });

  it('returns "warn" when percentage is between 60 (inclusive) and 85 (exclusive)', () => {
    expect(usageTier(60)).toBe('warn');
    expect(usageTier(73)).toBe('warn');
    expect(usageTier(84.9)).toBe('warn');
  });

  it('returns "danger" when percentage is 85 or above', () => {
    expect(usageTier(85)).toBe('danger');
    expect(usageTier(95)).toBe('danger');
    expect(usageTier(100)).toBe('danger');
    expect(usageTier(110)).toBe('danger');
  });

  it('clamps negative input to "good"', () => {
    expect(usageTier(-5)).toBe('good');
  });
});
