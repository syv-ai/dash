import { describe, it, expect } from 'vitest';
import { fitUsage, USAGE_COMFORT_PX as comfort } from '../usageDensity';

describe('fitUsage', () => {
  // Natural widths: every column with the pace, then without it.
  const needs = [400, 300];

  it('keeps every column, pace included, while they fit with room to spare', () => {
    expect(fitUsage(400 + comfort, needs)).toBe('full');
    expect(fitUsage(520, needs)).toBe('full');
  });

  it('drops the pace first, before the row is merely full', () => {
    expect(fitUsage(400 + comfort - 1, needs)).toBe('noPace');
    expect(fitUsage(400, needs)).toBe('noPace');
    expect(fitUsage(300 + comfort, needs)).toBe('noPace');
  });

  it('falls back to bare percentages before the rings are cramped', () => {
    expect(fitUsage(300 + comfort - 1, needs)).toBe('compact');
    expect(fitUsage(300, needs)).toBe('compact');
  });

  it('starts compact, never overflowing, until measured', () => {
    expect(fitUsage(1000, [])).toBe('compact');
  });
});
