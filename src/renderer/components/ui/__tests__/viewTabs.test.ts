import { describe, it, expect } from 'vitest';
import { fitViewTabs } from '../ViewTabs';

describe('fitViewTabs', () => {
  // Natural widths, the corner inset included in both: counts, labels alone.
  const needs = [260, 219];

  it('keeps the counts while they fit', () => {
    expect(fitViewTabs(260, needs)).toBe('full');
  });

  it('then drops the counts, never the labels or the inset', () => {
    expect(fitViewTabs(259, needs)).toBe('uncounted');
    expect(fitViewTabs(100, needs)).toBe('uncounted');
  });
});
