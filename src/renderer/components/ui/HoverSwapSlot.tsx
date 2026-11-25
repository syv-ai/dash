import React from 'react';
import { cn } from '../../lib/cn';

interface HoverSwapSlotProps {
  /** The row's quiet trailing values (an orb, a count, a percentage). Give them
   *  fixed widths so they line up down a list. They fade out on hover. */
  rest?: React.ReactNode;
  /** Slide in from the row's right edge, across `rest`, while the enclosing
   *  `group/swap` row is hovered or keyboard-focused (it, or a control in
   *  it). Not bound to `rest`'s width. */
  actions: React.ReactNode;
  /** Keep `actions` shown without hover, e.g. while one of their menus is open.
   *  A Radix menu or popover opened from an action (its trigger's
   *  `data-state="open"`) keeps them shown by itself. */
  revealed?: boolean;
}

/**
 * The trailing end of a sidebar row: quiet values at rest, the row's actions on
 * hover or keyboard focus. The actions are an overlay, so they never reserve space and nothing to
 * their left moves when they appear. The row must carry the `group/swap` class.
 */
export function HoverSwapSlot({ rest, actions, revealed = false }: HoverSwapSlotProps) {
  return (
    <div className="group/slot relative flex shrink-0 items-center justify-end">
      <div
        className={cn(
          'flex items-center transition-opacity duration-200 ease-out',
          revealed
            ? 'opacity-0'
            : 'opacity-100 group-hover/swap:opacity-0 group-focus-visible/swap:opacity-0 group-has-[:focus-visible]/swap:opacity-0 group-has-[[data-state=open]]/slot:opacity-0',
        )}
      >
        {rest}
      </div>
      {/* The clip box sits at the row's right edge; the actions slide their
          full width in from behind it, like a drawer. */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex items-center overflow-x-clip',
          !revealed &&
            'pointer-events-none group-hover/swap:pointer-events-auto group-focus-visible/swap:pointer-events-auto group-has-[:focus-visible]/swap:pointer-events-auto has-[[data-state=open]]:pointer-events-auto',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-0.5 transition-[opacity,translate] duration-200 ease-out',
            revealed
              ? 'translate-x-0 opacity-100'
              : 'translate-x-full opacity-0 group-hover/swap:translate-x-0 group-hover/swap:opacity-100 group-focus-visible/swap:translate-x-0 group-focus-visible/swap:opacity-100 group-has-[:focus-visible]/swap:translate-x-0 group-has-[:focus-visible]/swap:opacity-100 has-[[data-state=open]]:translate-x-0 has-[[data-state=open]]:opacity-100',
          )}
        >
          {actions}
        </div>
      </div>
    </div>
  );
}
