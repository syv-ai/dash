import { describe, it, expect } from 'vitest';
import { fitViewRow, viewRowMinPx, VIEW_ROW_END_PX } from '../viewRowFit';

describe('fitViewRow', () => {
  // Tabs at their least; the extras (comments, PR) measured alone.
  const tabs = 200;
  const extras = [40, 50];
  // The row's chrome beside the tabs: the gap after them, the middle's
  // padding and the row's end padding.
  const chrome = 2 + 8 + 4;
  // Details with the gap before it; an extra after the first takes a gap.
  const details = 2 + 24;
  const all = tabs + chrome + 40 + 2 + 50 + details;

  it('shows everything while it all fits', () => {
    expect(fitViewRow(all, tabs, extras, false)).toEqual({ extras: [true, true], details: true });
    expect(fitViewRow(all + 100, tabs, extras, false).details).toBe(true);
  });

  it('drops Details before the extras', () => {
    expect(fitViewRow(all - 1, tabs, extras, false)).toEqual({
      extras: [true, true],
      details: false,
    });
  });

  it('then drops the extras, last first, and brings Details back where it fits', () => {
    // No room for the PR beside the comments: Details fits in what's left.
    expect(fitViewRow(tabs + chrome + 40 + details, tabs, extras, false)).toEqual({
      extras: [true, false],
      details: true,
    });
    expect(fitViewRow(tabs + chrome + 40, tabs, extras, false)).toEqual({
      extras: [true, false],
      details: false,
    });
  });

  it("doesn't let a wide extra that can't fit take a narrower one after it down", () => {
    // Room for the PR alone (50), not for the wider comments (60).
    expect(fitViewRow(tabs + chrome + 55, tabs, [60, 50], false)).toEqual({
      extras: [false, true],
      details: false,
    });
  });

  it('keeps Details first while it is the view shown', () => {
    expect(fitViewRow(all - 1, tabs, extras, true)).toEqual({
      extras: [true, false],
      details: true,
    });
  });

  it('always fits Details alone at the least width the sidebar is kept at', () => {
    const rowAtLeast = viewRowMinPx(tabs) - 8; // the list column's gutter
    expect(fitViewRow(rowAtLeast, tabs, [], false).details).toBe(true);
    expect(fitViewRow(rowAtLeast, tabs, extras, false)).toEqual({
      extras: [false, false],
      details: true,
    });
  });
});

describe('viewRowMinPx', () => {
  it('is the tabs at their least, the empty middle, the row end and the gutter', () => {
    // Normal mode's labels measure 207 px (D176), plus the fixed 12 px inset.
    expect(viewRowMinPx(219)).toBe(219 + 8 + VIEW_ROW_END_PX + 8);
    expect(viewRowMinPx(219)).toBe(267);
  });
});
