import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  handOffWidth,
  listWidthFrom,
  loadListWidth,
  saveListWidth,
  loadInspectorWidths,
  saveInspectorWidth,
  widthOnExpandedToggle,
  widthOnShow,
} from '../inspectorWidths';

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

const widths = { narrow: 26, expanded: 50 };

describe('widthOnExpandedToggle', () => {
  it('eases a shown sidebar to the state’s width', () => {
    expect(widthOnExpandedToggle({ expanded: true, collapsed: false, widths })).toBe(50);
    expect(widthOnExpandedToggle({ expanded: false, collapsed: false, widths })).toBe(26);
  });

  it('keeps a collapsed sidebar collapsed when it goes narrow behind it', () => {
    expect(widthOnExpandedToggle({ expanded: false, collapsed: true, widths })).toBeNull();
  });

  it('shows a collapsed sidebar when it expands', () => {
    expect(widthOnExpandedToggle({ expanded: true, collapsed: true, widths })).toBe(50);
  });
});

describe('widthOnShow', () => {
  const narrowMax = 40;

  it('comes back at the width it collapsed from, narrow or expanded', () => {
    const expanded = { expandedAtCollapse: true, expanded: true, restored: 57, widths, narrowMax };
    expect(widthOnShow(expanded)).toBeNull();
    const narrow = { expandedAtCollapse: false, expanded: false, restored: 30, widths, narrowMax };
    expect(widthOnShow(narrow)).toBeNull();
  });

  it('takes the narrow width when it went narrow while collapsed', () => {
    expect(
      widthOnShow({ expandedAtCollapse: true, expanded: false, restored: 57, widths, narrowMax }),
    ).toBe(26);
  });

  it('takes the expanded width when it expanded while collapsed', () => {
    expect(
      widthOnShow({ expandedAtCollapse: false, expanded: true, restored: 30, widths, narrowMax }),
    ).toBe(50);
  });

  it('narrows a layout persisted expanded', () => {
    expect(
      widthOnShow({ expandedAtCollapse: false, expanded: false, restored: 55, widths, narrowMax }),
    ).toBe(26);
  });
});

describe('stored widths', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the expanded width under its stored name, `wide`', () => {
    const store = new Map<string, string>([
      ['dash:inspector-widths', JSON.stringify({ narrow: 30, wide: 55 })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    expect(loadInspectorWidths()).toEqual({ narrow: 30, expanded: 55 });
    saveInspectorWidth('expanded', 60);
    expect(JSON.parse(store.get('dash:inspector-widths')!)).toEqual({ narrow: 30, wide: 60 });
  });
});

describe('list column widths', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults per mode: the tree 30%, review mode 45%', () => {
    expect(listWidthFrom('normal', {}, null)).toBe(30);
    expect(listWidthFrom('review', {}, null)).toBe(45);
  });

  it('keeps each mode its own dragged width', () => {
    const stored = { list: 28, reviewList: 52 };
    expect(listWidthFrom('normal', stored, null)).toBe(28);
    expect(listWidthFrom('review', stored, null)).toBe(52);
  });

  it("takes normal mode's width from the panel library's old layout until it has its own", () => {
    expect(listWidthFrom('normal', {}, { list: 33.97, main: 66.03 })).toBe(33.97);
    expect(listWidthFrom('review', {}, { list: 33.97, main: 66.03 })).toBe(45);
    expect(listWidthFrom('normal', { list: 25 }, { list: 33.97 })).toBe(25);
  });

  it('stores beside the sidebar widths without dropping them', () => {
    const store = new Map<string, string>([
      ['dash:inspector-widths', JSON.stringify({ narrow: 30, wide: 55 })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    saveListWidth('review', 50);
    saveInspectorWidth('narrow', 27);
    expect(JSON.parse(store.get('dash:inspector-widths')!)).toEqual({
      narrow: 27,
      wide: 55,
      reviewList: 50,
    });
    expect(loadListWidth('review')).toBe(50);
    expect(loadListWidth('normal')).toBe(30);
  });
});
