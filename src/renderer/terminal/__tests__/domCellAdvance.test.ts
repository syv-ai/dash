import { describe, it, expect } from 'vitest';
import { domCellAdvance, nextDomCellWidth } from '../domCellAdvance';

describe('domCellAdvance', () => {
  it('is the probe width per glyph', () => {
    expect(domCellAdvance(796.4, 100, 7.83)).toBeCloseTo(7.964);
  });

  it('ignores a read far from the reported cell (a probe not laid out yet)', () => {
    expect(domCellAdvance(0, 100, 7.83)).toBeUndefined();
    expect(domCellAdvance(10.6, 100, 7.83)).toBeUndefined();
    expect(domCellAdvance(17500, 100, 7.83)).toBeUndefined();
    expect(domCellAdvance(Number.NaN, 100, 7.83)).toBeUndefined();
  });
});

describe('nextDomCellWidth', () => {
  it('keeps a stable measure, so the re-fit converges', () => {
    expect(nextDomCellWidth(7.96, 7.98)).toBeUndefined();
    expect(nextDomCellWidth(undefined, 7.96)).toBe(7.96);
    expect(nextDomCellWidth(7.83, 7.96)).toBe(7.96);
  });

  it('never takes a bogus read', () => {
    expect(nextDomCellWidth(7.96, undefined)).toBeUndefined();
  });
});
