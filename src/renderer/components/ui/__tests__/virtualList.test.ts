import { describe, expect, it } from 'vitest';
import type { Virtualizer } from '@tanstack/react-virtual';
import { measureShown } from '../VirtualList';

/** An item element as the measure sees it: its height, and whether it is
 *  rendered at all (a `display: none` ancestor leaves it no boxes). */
function item(index: number, height: number, rendered = true) {
  return {
    dataset: { index: String(index) },
    getAttribute: (name: string) => (name === 'data-index' ? String(index) : null),
    offsetHeight: height,
    getClientRects: () => (rendered ? [{}] : []),
  } as unknown as HTMLElement;
}

/** A virtualizer that has measured `sizes` (by key `row-<index>`). */
function virtualizer(sizes: Record<number, number>) {
  return {
    options: {
      horizontal: false,
      getItemKey: (i: number) => `row-${i}`,
      estimateSize: () => 32,
      indexAttribute: 'data-index',
    },
    itemSizeCache: new Map(Object.entries(sizes).map(([i, s]) => [`row-${i}`, s])),
    indexFromElement: (el: HTMLElement) => Number(el.dataset.index),
  } as unknown as Virtualizer<HTMLDivElement, HTMLElement>;
}

/** What a ResizeObserver reports for an element `height` tall. */
const entry = (height: number) =>
  ({ borderBoxSize: [{ blockSize: height, inlineSize: 300 }] }) as unknown as ResizeObserverEntry;

describe('measureShown', () => {
  it('measures a rendered item', () => {
    expect(measureShown(item(3, 28), entry(28), virtualizer({}))).toBe(28);
  });

  it('keeps an item’s size while the list is hidden (the railed task sidebar)', () => {
    // Hiding fires every item's ResizeObserver with 0; caching that collapses
    // the rows, and only those in view ever measure again (B1).
    expect(measureShown(item(3, 0, false), entry(0), virtualizer({ 3: 32 }))).toBe(32);
  });

  it('estimates a hidden item it never measured', () => {
    expect(measureShown(item(3, 0, false), entry(0), virtualizer({}))).toBe(32);
  });

  it('takes 0 from a rendered item that is empty', () => {
    expect(measureShown(item(3, 0), entry(0), virtualizer({ 3: 32 }))).toBe(0);
  });
});
