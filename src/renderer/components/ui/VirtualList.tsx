import * as React from 'react';
import { measureElement, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { cn } from '../../lib/cn';

export interface VirtualListHandle {
  /** Scroll so item `index` shows (the least scroll that does). */
  scrollToIndex(index: number): void;
}

/**
 * The virtualizer's own measure, except for an item that isn't rendered (a
 * `display: none` ancestor, e.g. the railed task sidebar): hiding fires every
 * item's ResizeObserver with 0, and caching that would collapse the rows,
 * which only the ones in view ever measure again (B1). It keeps the size it
 * had instead. Checks only a 0, so a re-render's measure stays layout-free.
 */
export function measureShown<T extends Element>(
  element: T,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLDivElement, T>,
): number {
  const size = measureElement(element, entry, instance);
  if (size > 0 || element.getClientRects().length > 0) return size;
  const index = instance.indexFromElement(element);
  return (
    instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
    instance.options.estimateSize(index)
  );
}

/**
 * A scrolling list that mounts only the items in view (plus a margin), so a
 * list of tens of thousands stays light. Items are measured as they render;
 * `estimateSize` only places the ones not yet seen. The element it renders
 * is the scroller, padded as a sidebar list (6px across, 8px below; `gapAbove`
 * 8px above too): size it through `className` (`flex-1 min-h-0`).
 */
export function VirtualList({
  count,
  itemKey,
  estimateSize,
  children,
  className,
  handleRef,
  gapAbove = false,
  gap,
  ...props
}: {
  count: number;
  itemKey: (index: number) => React.Key;
  estimateSize: (index: number) => number;
  /** Renders item `index`. */
  children: (index: number) => React.ReactNode;
  className?: string;
  handleRef?: React.Ref<VirtualListHandle>;
  /** 8px above the first item, when nothing heads the list. */
  gapAbove?: boolean;
  /** Pixels between items. */
  gap?: number;
} & Omit<React.ComponentProps<'div'>, 'children' | 'style'>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey: itemKey,
    overscan: 12,
    gap,
    measureElement: measureShown,
  });
  React.useImperativeHandle(
    handleRef,
    () => ({ scrollToIndex: (index) => virtualizer.scrollToIndex(index, { align: 'auto' }) }),
    [virtualizer],
  );
  return (
    <div
      {...props}
      ref={scrollRef}
      className={cn(
        'scrollbar-gutter-stable scrollbar-thin-hover overflow-y-auto px-1.5 pb-2',
        gapAbove && 'pt-2',
        className,
      )}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {children(item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
