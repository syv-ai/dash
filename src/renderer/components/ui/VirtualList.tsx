import * as React from 'react';
import {
  measureElement,
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from '@tanstack/react-virtual';
import { cn } from '../../lib/cn';
import { EASE, reducedMotion } from '../../lib/motion';
import {
  LIST_MOTION_MS,
  enterKeyframes,
  exitKeyframes,
  goneRows,
  hideWindow,
  newRows,
  oneRun,
  revealWindow,
  sameKeys,
  slideRoom,
  slides,
  type RunSlot,
  type SlideMove,
  type Slot,
} from './VirtualListMotion';

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

/** Each item's wrapper: placed by the virtualizer through `transform`. */
const ITEM = 'absolute top-0 left-0 w-full';
const translate = (y: number) => `translateY(${y}px)`;

/** A removed row kept for its exit: its last render, at its old place. */
interface Ghost extends RunSlot {
  node: React.ReactNode;
}

/** What the last commit showed, for the next change to move from. */
interface Shown {
  keys: readonly React.Key[];
  slots: Slot[];
  nodes: Map<React.Key, React.ReactNode>;
  /** The virtualizer's layout of every row (rendered or not), then. */
  layout: readonly VirtualItem[];
}

/**
 * Plays the list's motion (`VirtualListMotion`, T14) as it changes: rows
 * that stay slide, new rows uncover, removed rows stay as ghosts while they
 * cover; a slide cut short by a later change (or a row's first measure)
 * carries on from where it shows. Only compositor properties, and nothing
 * is read from the page outside a change (then all reads come before any
 * animation starts, so the page lays out once), so scrolling costs what it
 * did. Off under reduced motion. Returns the ghosts to render after the
 * rows, each a `data-ghost` element.
 */
function useListMotion(
  enabled: boolean,
  keys: readonly React.Key[],
  items: readonly VirtualItem[],
  nodes: Map<React.Key, React.ReactNode>,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  boxRef: React.RefObject<HTMLDivElement | null>,
): Ghost[] {
  const shown = React.useRef<Shown | null>(null);
  const sliding = React.useRef(new Map<React.Key, { anim: Animation; to: number }>());
  /** Ghosts whose exit has started, and those it has finished. */
  const exiting = React.useRef(new WeakSet<Ghost>());
  const done = React.useRef(new WeakSet<Ghost>());
  /** Ghosts still covering. A ref, so filing one costs no render; the
   *  list renders once more when they're done. */
  const ghosts = React.useRef<Ghost[]>([]);
  const [, dropped] = React.useReducer((n: number) => n + 1, 0);

  // The rows this change removes become ghosts in the same render, so each
  // keeps its element and its last render (React bails out on the same
  // node): nothing remounts. Planned once per `keys`. A change of more than
  // one run (`oneRun`) cuts: no ghosts, and the ones still covering go.
  const change = React.useRef<{
    keys: readonly React.Key[];
    listed: Set<React.Key>;
    leaving: Ghost[];
    cut: boolean;
  }>(null);
  if (change.current?.keys !== keys) {
    const was = shown.current;
    const moving = enabled && was !== null && !sameKeys(was.keys, keys) && !reducedMotion();
    const listed = moving ? new Set(keys) : new Set<React.Key>();
    const gone = moving ? goneRows(was.slots, (k) => listed.has(k)) : [];
    const before = new Set(was?.keys);
    const entering = moving
      ? newRows(
          items.map(({ key, start, size }) => ({ key, start, size })),
          (k) => before.has(k),
        )
      : [];
    const cut = moving && !oneRun(entering, gone);
    const leaving = cut
      ? []
      : gone.flatMap((g) => {
          const node = was!.nodes.get(g.key);
          return node === undefined ? [] : [{ ...g, node }];
        });
    change.current = { keys, listed, leaving, cut };
  }
  const { listed, leaving, cut } = change.current;
  // This change's ghosts render now, before the effect below files them.
  const filed = new Set(ghosts.current);
  const rendered = cut
    ? []
    : [...ghosts.current, ...leaving.filter((g) => !filed.has(g))].filter(
        (g) => !nodes.has(g.key) && !done.current.has(g),
      );

  React.useLayoutEffect(() => {
    const slots = items.map(({ key, start, size }) => ({ key, start, size }));
    const was = shown.current;
    shown.current = { keys, slots, nodes, layout: virtualizer.measurementsCache };
    const box = boxRef.current;
    if (!enabled || !was || !box || reducedMotion()) return;
    const changed = !sameKeys(was.keys, keys);
    if (changed && cut) {
      // Every row straight to its place.
      for (const { anim } of sliding.current.values()) anim.cancel();
      sliding.current.clear();
      return;
    }
    const fresh = rendered.filter((g) => !exiting.current.has(g));
    if (!changed && sliding.current.size === 0 && fresh.length === 0) return;

    // Reads.
    const rows = new Map<React.Key, HTMLElement>();
    const ghostEls: HTMLElement[] = [];
    for (const child of box.children) {
      const el = child as HTMLElement;
      if (el.dataset.index !== undefined) rows.set(keys[Number(el.dataset.index)]!, el);
      else if (el.dataset.ghost !== undefined) ghostEls[Number(el.dataset.ghost)] = el;
    }
    const scroller = box.parentElement!;
    const bottom = scroller.getBoundingClientRect().bottom - box.getBoundingClientRect().top;
    /** Where a sliding row shows now, mid-slide. */
    const showsAt = (key: React.Key) => {
      const el = rows.get(key);
      return el && new DOMMatrix(getComputedStyle(el).transform).m42;
    };
    const now = new Map(slots.map((s) => [s.key, s.start]));
    const slidesNow: (SlideMove & { duration?: number })[] = [];
    const stops: Animation[] = [];
    for (const [key, { anim, to }] of sliding.current) {
      const start = now.get(key);
      if (start === undefined) stops.push(anim);
      else if (start !== to && !changed) {
        // Moved again since (its first measure): on from where it shows,
        // for the time it had left.
        const from = showsAt(key);
        if (from === undefined) continue;
        stops.push(anim);
        const left = LIST_MOTION_MS - Number(anim.currentTime ?? 0);
        slidesNow.push({ key, from, to: start, at: start, duration: Math.max(left, 60) });
      }
    }
    let enters: { el: HTMLElement; size: number; reveal: readonly [number, number] }[] = [];
    if (changed) {
      const before = new Map(was.keys.map((k, i) => [k, i]));
      const entering = newRows(slots, (k) => before.has(k));
      // The rows below a run move as far as its edge does (`slideRoom`), so
      // a run taller than the view folds or opens in step with them.
      const moves = slides({
        after: slots,
        startBefore: (k) => {
          const i = before.get(k);
          return i === undefined ? undefined : was.layout[i]?.start;
        },
        maxDistance: slideRoom([...entering, ...leaving], bottom, scroller.clientHeight),
      });
      for (const move of moves) {
        const running = sliding.current.get(move.key);
        const from = running ? showsAt(move.key) : undefined;
        if (running) stops.push(running.anim);
        slidesNow.push(from === undefined ? move : { ...move, from });
      }
      enters = entering.flatMap((s) => {
        const el = rows.get(s.key);
        return el ? [{ el, size: s.size, reveal: revealWindow(s, bottom) }] : [];
      });
    }

    // Writes.
    const timing = (duration = LIST_MOTION_MS) => ({ duration, easing: EASE.calm });
    for (const anim of stops) anim.cancel();
    for (const { key, from, to, at, duration } of slidesNow) {
      const el = rows.get(key);
      if (!el) continue;
      const anim = el.animate(
        [{ transform: translate(from) }, { transform: translate(to) }],
        timing(duration),
      );
      const entry = { anim, to: at };
      sliding.current.set(key, entry);
      anim.onfinish = anim.oncancel = () => {
        if (sliding.current.get(key) === entry) sliding.current.delete(key);
      };
    }
    for (const { el, size, reveal } of enters) el.animate(enterKeyframes(size, reveal), timing());
    for (const ghost of fresh) {
      const el = ghostEls[rendered.indexOf(ghost)];
      if (!el) {
        done.current.add(ghost);
        continue;
      }
      exiting.current.add(ghost);
      const anim = el.animate(exitKeyframes(ghost.size, hideWindow(ghost, bottom)), {
        ...timing(),
        fill: 'forwards',
      });
      anim.onfinish = () => {
        done.current.add(ghost);
        ghosts.current = ghosts.current.filter((x) => x !== ghost);
        dropped();
      };
    }
  });

  // File this change's ghosts (and drop any whose row came back).
  React.useLayoutEffect(() => {
    if (cut) {
      for (const g of ghosts.current) done.current.add(g);
      ghosts.current = [];
      return;
    }
    if (leaving.length === 0 && listed.size === 0) return;
    ghosts.current = [...ghosts.current.filter((x) => !listed.has(x.key)), ...leaving];
  }, [leaving, listed, cut]);

  return rendered;
}

/**
 * A scrolling list that mounts only the items in view (plus a margin), so a
 * list of tens of thousands stays light. Items are measured as they render;
 * `estimateSize` only places the ones not yet seen. The element it renders
 * is the scroller, padded as a sidebar list (6px across, 8px below; `gapAbove`
 * 8px above too): size it through `className` (`flex-1 min-h-0`).
 *
 * `animate`: rows move as the list changes (`useListMotion`): a new `keys`
 * array that differs from the last is a change; pass the same array (or an
 * equal one) when nothing changed.
 */
export function VirtualList({
  keys,
  estimateSize,
  children,
  className,
  handleRef,
  gapAbove = false,
  gap,
  animate = false,
  ...props
}: {
  /** Every item's key, in order: the list. */
  keys: readonly React.Key[];
  estimateSize: (index: number) => number;
  /** Renders item `index`. */
  children: (index: number) => React.ReactNode;
  className?: string;
  handleRef?: React.Ref<VirtualListHandle>;
  /** 8px above the first item, when nothing heads the list. */
  gapAbove?: boolean;
  /** Pixels between items. */
  gap?: number;
  /** Rows slide, enter and leave as the list changes. */
  animate?: boolean;
} & Omit<React.ComponentProps<'div'>, 'children' | 'style'>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey: (i) => keys[i]!,
    overscan: 12,
    gap,
    measureElement: measureShown,
  });
  React.useImperativeHandle(
    handleRef,
    () => ({ scrollToIndex: (index) => virtualizer.scrollToIndex(index, { align: 'auto' }) }),
    [virtualizer],
  );
  const items = virtualizer.getVirtualItems();
  const nodes = new Map<React.Key, React.ReactNode>();
  for (const item of items) nodes.set(item.key, children(item.index));
  const ghosts = useListMotion(
    animate,
    keys,
    items,
    nodes,
    virtualizer as Virtualizer<HTMLDivElement, Element>,
    boxRef,
  );
  return (
    <div
      {...props}
      ref={scrollRef}
      className={cn(
        'scrollbar-thin-hover overflow-y-auto px-1.5 pb-2',
        gapAbove && 'pt-2',
        className,
      )}
    >
      <div ref={boxRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className={ITEM}
            style={{ transform: translate(item.start) }}
          >
            {nodes.get(item.key)}
          </div>
        ))}
        {ghosts.map((g, i) => (
          <div
            key={g.key}
            data-ghost={i}
            aria-hidden
            inert
            className={cn(ITEM, 'pointer-events-none')}
            style={{ transform: translate(g.start) }}
          >
            {g.node}
          </div>
        ))}
      </div>
    </div>
  );
}
