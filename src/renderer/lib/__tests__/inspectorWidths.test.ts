import { describe, it, expect } from 'vitest';
import { handOffWidth } from '../inspectorWidths';

const bounds = { min: 14, max: 65 };

describe('handOffWidth', () => {
  it('gives the room a collapsing left sidebar frees to the task sidebar', () => {
    expect(handOffWidth({ inspector: 50, leftBefore: 18, leftAfter: 3, ...bounds })).toBe(65);
    expect(handOffWidth({ inspector: 40, leftBefore: 18, leftAfter: 3, ...bounds })).toBe(55);
  });

  it('takes the room an expanding left sidebar needs back from the task sidebar', () => {
    expect(handOffWidth({ inspector: 55, leftBefore: 3, leftAfter: 18, ...bounds })).toBe(40);
  });

  it('stays within the task sidebar bounds; the centre absorbs the rest', () => {
    expect(handOffWidth({ inspector: 60, leftBefore: 20, leftAfter: 3, ...bounds })).toBe(65);
    expect(handOffWidth({ inspector: 20, leftBefore: 3, leftAfter: 18, ...bounds })).toBe(14);
  });

  it('round-trips: collapse then expand restores the width', () => {
    const collapsed = handOffWidth({ inspector: 45, leftBefore: 18, leftAfter: 3, ...bounds });
    expect(handOffWidth({ inspector: collapsed, leftBefore: 3, leftAfter: 18, ...bounds })).toBe(
      45,
    );
  });
});
