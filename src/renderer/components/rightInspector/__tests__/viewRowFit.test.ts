import { describe, it, expect } from 'vitest';
import { fitExtras, viewRowMinPx, VIEW_ROW_END_PX } from '../viewRowFit';

describe('fitExtras', () => {
  // The middle with both extras (comments, PR), then with the first alone.
  const needs = [90, 40];

  it('shows every extra while they fit whole', () => {
    expect(fitExtras(90, needs)).toBe(2);
    expect(fitExtras(400, needs)).toBe(2);
  });

  it('gives way whole, last first, rather than clipping under Details', () => {
    expect(fitExtras(89, needs)).toBe(1);
    expect(fitExtras(40, needs)).toBe(1);
    expect(fitExtras(39, needs)).toBe(0);
  });

  it('shows none with none to show, or before measuring', () => {
    expect(fitExtras(400, [])).toBe(0);
  });
});

describe('viewRowMinPx', () => {
  it('is the bare labels, the empty middle, the row end and the gutter: no inset', () => {
    // Normal mode's labels measure 207 px (D176): the 12 px inset no longer counts.
    expect(viewRowMinPx(207)).toBe(207 + 8 + VIEW_ROW_END_PX + 8);
    expect(viewRowMinPx(207)).toBe(255);
  });
});
