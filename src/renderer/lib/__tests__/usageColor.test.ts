import { describe, it, expect } from 'vitest';
import { quietUsageColor, usageColor } from '../usageColor';

const DONE = 'hsl(var(--state-done))';
const INK = 'hsl(var(--ink))';
const WARN = 'hsl(var(--warn))';
const FAIL = 'hsl(var(--state-fail))';

describe('usageColor', () => {
  it('is the done green up to 40 %', () => {
    expect(usageColor(0)).toBe(DONE);
    expect(usageColor(40)).toBe(DONE);
  });

  it('eases from green to amber between 40 and 65 %', () => {
    expect(usageColor(52.5)).toBe(`color-mix(in oklch, ${WARN} 50%, ${DONE})`);
  });

  it('turns the warn amber at 65 % and eases to red by 100 %', () => {
    expect(usageColor(65)).toBe(WARN);
    expect(usageColor(82)).toBe(`color-mix(in oklch, ${FAIL} 48.6%, ${WARN})`);
    expect(usageColor(100)).toBe(FAIL);
  });

  it('clamps out-of-range and NaN input', () => {
    expect(usageColor(-5)).toBe(DONE);
    expect(usageColor(Number.NaN)).toBe(DONE);
    expect(usageColor(140)).toBe(FAIL);
  });
});

describe('quietUsageColor', () => {
  it('is plain ink below 65 %, never green', () => {
    expect(quietUsageColor(0)).toBe(INK);
    expect(quietUsageColor(40)).toBe(INK);
    expect(quietUsageColor(64.9)).toBe(INK);
  });

  it('shares the amber-to-red top half', () => {
    expect(quietUsageColor(65)).toBe(WARN);
    expect(quietUsageColor(82)).toBe(usageColor(82));
    expect(quietUsageColor(100)).toBe(FAIL);
  });

  it('clamps out-of-range and NaN input', () => {
    expect(quietUsageColor(Number.NaN)).toBe(INK);
    expect(quietUsageColor(140)).toBe(FAIL);
  });
});
