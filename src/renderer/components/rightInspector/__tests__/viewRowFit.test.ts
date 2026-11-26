import { describe, it, expect } from 'vitest';
import { fitViewRow, viewRowMinPx, VIEW_ROW_END_PX } from '../viewRowFit';

describe('fitViewRow', () => {
  // Tabs at their least; the extras (comments, PR) measured alone, each with
  // its icon-only compact form.
  const tabs = 200;
  const comments = { px: 40, compactPx: 24 };
  const pr = { px: 50, compactPx: 24 };
  const extras = [comments, pr];
  // The row's chrome beside the tabs: the gap after them, the middle's
  // padding and the row's end padding.
  const chrome = 2 + 8 + 4;
  // Details with the gap before it; an extra after the first takes a gap.
  const details = 2 + 24;
  const all = tabs + chrome + 40 + 2 + 50 + details;

  it('shows everything while it all fits', () => {
    expect(fitViewRow(all, tabs, extras, false)).toEqual({
      extras: ['full', 'full'],
      details: true,
    });
    expect(fitViewRow(all + 100, tabs, extras, false).details).toBe(true);
  });

  it('drops Details before the extras', () => {
    expect(fitViewRow(all - 1, tabs, extras, false)).toEqual({
      extras: ['full', 'full'],
      details: false,
    });
  });

  it('then compacts the extras, last first, before dropping them', () => {
    const prFull = tabs + chrome + 40 + 2 + 50;
    expect(fitViewRow(prFull - 1, tabs, extras, false)).toEqual({
      extras: ['full', 'compact'],
      details: false,
    });
    expect(fitViewRow(tabs + chrome + 40 + 2 + 24 - 1, tabs, extras, false)).toEqual({
      extras: ['full', 'hidden'],
      details: false,
    });
    expect(fitViewRow(tabs + chrome + 24, tabs, extras, false)).toEqual({
      extras: ['compact', 'hidden'],
      details: false,
    });
  });

  it('never brings Details back in place of an extra that gave way', () => {
    // The user's report: the PR button alone, no room for it in full but room
    // for Details. Before, Details took its place.
    expect(fitViewRow(tabs + chrome + 30, tabs, [pr], false)).toEqual({
      extras: ['compact'],
      details: false,
    });
    // Without a compact form it hides, and Details stays hidden too.
    expect(fitViewRow(tabs + chrome + 30, tabs, [{ px: 50 }], false)).toEqual({
      extras: ['hidden'],
      details: false,
    });
  });

  it("doesn't let a wide extra that can't fit take a narrower one after it down", () => {
    // Room for the PR alone (50), not for the wider comments (60).
    expect(fitViewRow(tabs + chrome + 55, tabs, [{ px: 60 }, { px: 50 }], false)).toEqual({
      extras: ['hidden', 'full'],
      details: false,
    });
  });

  it('keeps Details first while it is the view shown', () => {
    expect(fitViewRow(all - 1, tabs, extras, true)).toEqual({
      extras: ['full', 'compact'],
      details: true,
    });
  });

  it('fits Details alone, or the first compact extra, at the least width the sidebar is kept at', () => {
    const rowAtLeast = viewRowMinPx(tabs) - 8; // the list column's gutter
    expect(fitViewRow(rowAtLeast, tabs, [], false).details).toBe(true);
    expect(fitViewRow(rowAtLeast, tabs, [pr], false)).toEqual({
      extras: ['compact'],
      details: false,
    });
    expect(fitViewRow(rowAtLeast, tabs, extras, false)).toEqual({
      extras: ['compact', 'hidden'],
      details: false,
    });
    expect(fitViewRow(rowAtLeast, tabs, [pr], true)).toEqual({
      extras: ['hidden'],
      details: true,
    });
  });
});

describe('viewRowMinPx', () => {
  it('is the tabs at their least, the empty middle, one icon slot, the row end and the gutter', () => {
    // Normal mode's labels measure 207 px (D176), plus the fixed 12 px inset.
    expect(viewRowMinPx(219)).toBe(219 + 8 + VIEW_ROW_END_PX + 8);
    expect(viewRowMinPx(219)).toBe(267);
  });
});
