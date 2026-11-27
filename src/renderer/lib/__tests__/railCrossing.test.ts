import { describe, expect, it } from 'vitest';
import { heldAcrossRail } from '../railCrossing';

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
