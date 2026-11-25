import { describe, expect, it } from 'vitest';
import { RAIL_BAR_MIN_PX, RAIL_HIT_MIN_PX, railBar } from '../railBar';

describe('railBar', () => {
  it('draws a long stretch at its true height', () => {
    expect(railBar(0.1, 0.2, 500)).toEqual({ top: 50, height: 100 });
  });

  it('never draws under the least height, centred on the stretch', () => {
    // One line of a 10,000-line file: a twentieth of a rail pixel.
    const bar = railBar(0.5, 0.0001, 500);
    expect(bar.height).toBe(RAIL_BAR_MIN_PX);
    expect(bar.top + bar.height / 2).toBeCloseTo(250.025);
  });

  it('draws a point (a deletion) at the least height', () => {
    expect(railBar(0.4, 0, 500)).toEqual({ top: 196, height: RAIL_BAR_MIN_PX });
  });

  it('stays inside the rail at either end', () => {
    expect(railBar(0, 0, 500)).toEqual({ top: 0, height: RAIL_BAR_MIN_PX });
    expect(railBar(1, 0, 500)).toEqual({ top: 500 - RAIL_BAR_MIN_PX, height: RAIL_BAR_MIN_PX });
    expect(railBar(0, 1, 500)).toEqual({ top: 0, height: 500 });
  });

  it('takes its own least for the hit box', () => {
    expect(railBar(0.5, 0, 500, RAIL_HIT_MIN_PX).height).toBe(RAIL_HIT_MIN_PX);
  });
});
