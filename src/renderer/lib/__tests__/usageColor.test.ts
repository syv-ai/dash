import { describe, it, expect } from 'vitest';
import { usageColor } from '../usageColor';

const CALM = 'hsl(var(--ink))';
const WARN = 'hsl(var(--warn))';
const FAIL = 'hsl(var(--state-fail))';

describe('usageColor', () => {
  it('is plain ink below 65 %, never green (green is a session at rest, S1)', () => {
    expect(usageColor(0)).toBe(CALM);
    expect(usageColor(40)).toBe(CALM);
    expect(usageColor(64.9)).toBe(CALM);
  });

  it('turns the warn amber at 65 %', () => {
    expect(usageColor(65)).toBe(WARN);
  });

  it('eases from amber towards red between 65 and 100 %', () => {
    expect(usageColor(82)).toBe(`color-mix(in oklch, ${FAIL} 48.6%, ${WARN})`);
  });

  it('is the fail red at 100 %', () => {
    expect(usageColor(100)).toBe(FAIL);
  });

  it('clamps out-of-range and NaN input', () => {
    expect(usageColor(-5)).toBe(CALM);
    expect(usageColor(Number.NaN)).toBe(CALM);
    expect(usageColor(140)).toBe(FAIL);
  });
});
