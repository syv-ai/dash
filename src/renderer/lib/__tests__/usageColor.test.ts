import { describe, it, expect } from 'vitest';
import { usageColor } from '../usageColor';

const DONE = 'hsl(var(--state-done))';
const NEEDS = 'hsl(var(--state-needs))';
const FAIL = 'hsl(var(--state-fail))';

describe('usageColor', () => {
  it('is the done green up to 40 %', () => {
    expect(usageColor(0)).toBe(DONE);
    expect(usageColor(40)).toBe(DONE);
  });

  it('eases from green towards yellow between 40 and 65 %', () => {
    expect(usageColor(52)).toBe(`color-mix(in oklch, ${NEEDS} 48%, ${DONE})`);
  });

  it('is the needs yellow at 65 %', () => {
    expect(usageColor(65)).toBe(NEEDS);
  });

  it('eases from yellow towards red between 65 and 100 %', () => {
    expect(usageColor(82)).toBe(`color-mix(in oklch, ${FAIL} 48.6%, ${NEEDS})`);
  });

  it('is the fail red at 100 %', () => {
    expect(usageColor(100)).toBe(FAIL);
  });

  it('clamps out-of-range and NaN input', () => {
    expect(usageColor(-5)).toBe(DONE);
    expect(usageColor(Number.NaN)).toBe(DONE);
    expect(usageColor(140)).toBe(FAIL);
  });
});
