import React from 'react';
import { cn } from '../../lib/cn';

interface HoverSwapSlotProps {
  /** The row's quiet trailing values (an orb, a count, a percentage). Give them
   *  fixed widths so they line up down a list. They give way on hover. */
  rest?: React.ReactNode;
  /** Take `rest`'s place while the enclosing `group/swap` row is hovered or
   *  keyboard-focused (it, or a control in it), fading in from the right.
   *  Not bound to `rest`'s width. */
  actions: React.ReactNode;
  /** Keep `actions` shown without hover, e.g. while one of their menus is open.
   *  A Radix menu or popover opened from an action (its trigger's
   *  `data-state="open"`) keeps them shown by itself. */
  revealed?: boolean;
}

/**
 * The trailing end of a sidebar row: quiet values at rest, the row's actions on
 * hover or keyboard focus. Whichever shows takes the room, the other none: at
 * rest the actions reserve nothing and the label runs up to `rest`; on hover
 * the label gives way to the actions (the task card's model, B2). The row must
 * carry the `group/swap` class.
 */
export function HoverSwapSlot({ rest, actions, revealed = false }: HoverSwapSlotProps) {
  return (
    <div className="group/slot flex shrink-0 items-center justify-end">
      {rest && (
        <div
          className={cn(
            'items-center',
            revealed
              ? 'hidden'
              : 'flex group-hover/swap:hidden group-focus-visible/swap:hidden group-has-[:focus-visible]/swap:hidden group-has-[[data-state=open]]/slot:hidden',
          )}
        >
          {rest}
        </div>
      )}
      <div
        className={cn(
          'items-center gap-0.5 transition-[opacity,translate] duration-200 ease-out starting:translate-x-2 starting:opacity-0',
          revealed
            ? 'flex'
            : 'hidden group-hover/swap:flex group-focus-visible/swap:flex group-has-[:focus-visible]/swap:flex has-[[data-state=open]]:flex',
        )}
      >
        {actions}
      </div>
    </div>
  );
}
