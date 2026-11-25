import { describe, it, expect } from 'vitest';
import { fitUsage } from '../usageDensity';

describe('fitUsage', () => {
  // Natural widths: every column with the burn rate, then without it.
  const needs = [400, 300];

  it('keeps every column, burn rate included, while they fit', () => {
    expect(fitUsage(400, needs)).toBe('full');
    expect(fitUsage(520, needs)).toBe('full');
  });

  it('drops the burn rate first', () => {
    expect(fitUsage(399, needs)).toBe('noBurn');
    expect(fitUsage(300, needs)).toBe('noBurn');
  });

  it('falls back to bare percentages once the rings no longer fit', () => {
    expect(fitUsage(299, needs)).toBe('compact');
  });

  it('starts compact, never overflowing, until measured', () => {
    expect(fitUsage(1000, [])).toBe('compact');
  });
});
