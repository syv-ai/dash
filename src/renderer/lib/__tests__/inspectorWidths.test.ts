import { describe, it, expect } from 'vitest';
import { handOffWidth, widthOnEditorToggle, widthOnExpand } from '../inspectorWidths';

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

const widths = { narrow: 26, wide: 50 };

describe('widthOnEditorToggle', () => {
  it('eases an expanded sidebar to the mode’s width', () => {
    expect(widthOnEditorToggle({ wide: true, collapsed: false, widths })).toBe(50);
    expect(widthOnEditorToggle({ wide: false, collapsed: false, widths })).toBe(26);
  });

  it('keeps a collapsed sidebar collapsed when the editor closes behind it', () => {
    expect(widthOnEditorToggle({ wide: false, collapsed: true, widths })).toBeNull();
  });

  it('shows a collapsed sidebar when the editor opens', () => {
    expect(widthOnEditorToggle({ wide: true, collapsed: true, widths })).toBe(50);
  });
});

describe('widthOnExpand', () => {
  const narrowMax = 40;

  it('comes back at the width it collapsed from, editor open or not', () => {
    const wide = { wideAtCollapse: true, wide: true, restored: 57, widths, narrowMax };
    expect(widthOnExpand(wide)).toBeNull();
    const narrow = { wideAtCollapse: false, wide: false, restored: 30, widths, narrowMax };
    expect(widthOnExpand(narrow)).toBeNull();
  });

  it('takes the narrow width when the editor closed while collapsed', () => {
    expect(
      widthOnExpand({ wideAtCollapse: true, wide: false, restored: 57, widths, narrowMax }),
    ).toBe(26);
  });

  it('takes the wide width when the editor opened while collapsed', () => {
    expect(
      widthOnExpand({ wideAtCollapse: false, wide: true, restored: 30, widths, narrowMax }),
    ).toBe(50);
  });

  it('narrows a layout persisted wide', () => {
    expect(
      widthOnExpand({ wideAtCollapse: false, wide: false, restored: 55, widths, narrowMax }),
    ).toBe(26);
  });
});
