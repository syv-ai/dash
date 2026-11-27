import { describe, expect, it } from 'vitest';
import { heldAcrossRail, railDragEnd } from '../railCrossing';

describe('heldAcrossRail', () => {
  it('holds the content at its open width, fading in, when the rail opens', () => {
    expect(heldAcrossRail({ px: 40, collapsed: true }, { px: 260.4, collapsed: false })).toEqual({
      width: 260,
      fade: 'in',
    });
  });

  it('holds it at the width it leaves, fading out, when it closes to the rail', () => {
    expect(heldAcrossRail({ px: 280, collapsed: false }, { px: 40, collapsed: true })).toEqual({
      width: 280,
      fade: 'out',
    });
  });

  it('holds nothing when the move stays on one side of the rail', () => {
    expect(
      heldAcrossRail({ px: 280, collapsed: false }, { px: 240, collapsed: false }),
    ).toBeUndefined();
    expect(
      heldAcrossRail({ px: 40, collapsed: true }, { px: 40, collapsed: true }),
    ).toBeUndefined();
  });
});

describe('railDragEnd', () => {
  const panel = { railPx: 56, minPx: 240 };

  it('snaps a width between the rail and the minimum to the minimum', () => {
    expect(railDragEnd({ ...panel, px: 66 })).toEqual({ open: true, px: 240 });
  });

  it('keeps a width at or past the minimum', () => {
    expect(railDragEnd({ ...panel, px: 240 })).toEqual({ open: true, px: 240 });
    expect(railDragEnd({ ...panel, px: 311.6 })).toEqual({ open: true, px: 312 });
  });

  it('stays on the rail when the drag ends within its slop', () => {
    expect(railDragEnd({ ...panel, px: 56 })).toEqual({ open: false });
    expect(railDragEnd({ ...panel, px: 59 })).toEqual({ open: false });
    expect(railDragEnd({ ...panel, px: 60 })).toEqual({ open: true, px: 240 });
  });
});
