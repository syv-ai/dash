import { describe, expect, it } from 'vitest';
import { leftHoldOf } from '../leftHold';

describe('leftHoldOf', () => {
  it('holds the content at its expanded width, fading in, when the rail opens', () => {
    expect(leftHoldOf({ px: 40, collapsed: true }, { px: 260.4, collapsed: false })).toEqual({
      width: 260,
      to: 'expanded',
    });
  });

  it('holds it at the width it leaves, fading out, when it closes to the rail', () => {
    expect(leftHoldOf({ px: 280, collapsed: false }, { px: 40, collapsed: true })).toEqual({
      width: 280,
      to: 'collapsed',
    });
  });

  it('holds nothing when the move stays on one side of the rail', () => {
    expect(
      leftHoldOf({ px: 280, collapsed: false }, { px: 240, collapsed: false }),
    ).toBeUndefined();
    expect(leftHoldOf({ px: 40, collapsed: true }, { px: 40, collapsed: true })).toBeUndefined();
  });
});
