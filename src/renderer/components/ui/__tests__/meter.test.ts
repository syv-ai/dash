import { describe, expect, it } from 'vitest';
import { clampPercent, usageTone } from '../Meter';

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

describe('usageTone', () => {
  it('is neutral below 60%, needs from 60%, fail from 80%', () => {
    expect(usageTone(0)).toBe('neutral');
    expect(usageTone(59.9)).toBe('neutral');
    expect(usageTone(60)).toBe('needs');
    expect(usageTone(79.9)).toBe('needs');
    expect(usageTone(80)).toBe('fail');
    expect(usageTone(250)).toBe('fail');
  });
});
