import * as React from 'react';
import { createPortal } from 'react-dom';

/** What a move would lose: the scroll offsets in the content, and its focus. */
interface Kept {
  scrolls: [Element, number, number][];
  focus: HTMLElement | null;
}

const kept = new WeakMap<HTMLElement, Kept>();

/**
 * Content that moves between places in the layout without remounting: it
 * renders once (`portal`, placed anywhere in the owner's tree) into a home of
 * its own (`host`), and a `MovableSlot` holding that host shows it where the
 * slot is. Remounting would rebuild its state (a tree's open folders) and
 * re-measure it in a place not yet laid out (a panel mounting at width 0), so
 * it would paint wrong until its observers caught up. Host and slot are
 * `display: contents`, so the content lays out as the slot's parent's child.
 */
export function useMovable(content: React.ReactNode) {
  const [host] = React.useState(() => {
    const div = document.createElement('div');
    div.style.display = 'contents';
    return div;
  });
  return { host, portal: createPortal(content, host) };
}

/**
 * Where a `useMovable` content shows; render one slot per host at a time. A
 * moved node loses its scroll offsets and focus, so the slot keeps them
 * before it lets go (React runs its cleanup before removing it) and the next
 * slot gives them back.
 */
export function MovableSlot({ host }: { host: HTMLElement }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    ref.current!.appendChild(host);
    const was = kept.get(host);
    if (was) {
      kept.delete(host);
      for (const [el, top, left] of was.scrolls) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
      if (was.focus?.isConnected) was.focus.focus({ preventScroll: true });
    }
    return () => {
      const scrolls: Kept['scrolls'] = [];
      for (const el of host.querySelectorAll('*')) {
        if (el.scrollTop || el.scrollLeft) scrolls.push([el, el.scrollTop, el.scrollLeft]);
      }
      const active = document.activeElement;
      const focus = active instanceof HTMLElement && host.contains(active) ? active : null;
      kept.set(host, { scrolls, focus });
    };
  }, [host]);
  return <div ref={ref} className="contents" />;
}
