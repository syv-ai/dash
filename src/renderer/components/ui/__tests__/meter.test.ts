import { describe, expect, it } from 'vitest';
import { clampPercent } from '../Meter';

describe('clampPercent', () => {
  it('keeps 0–100 and clamps outside it', () => {
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
  });

  it('reads NaN as 0', () => {
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});
