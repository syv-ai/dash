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
  /** Lay `rest` and `actions` in one cell, the hidden one invisible, so the
   *  slot is always the wider of the two and nothing beside it moves on
   *  hover (the task card's last column, T24/T26). Default: whichever shows
   *  takes the room, the other none (B2). */
  reserve?: boolean;
}

/** Each layer's classes: `idle` lets `swap-shown` (index.css: the row hovered
 *  or keyboard-focused, or a menu open from the slot) show the actions;
 *  `revealed` shows them outright. By default the hidden layer takes no room;
 *  `reserve`d, both share one grid cell and the hidden one keeps its room
 *  unseen. Visibility, unlike display, transitions, so there the actions fade
 *  in from the right without `@starting-style`, and (the transition only on
 *  the shown side) vanish at once as `rest` returns, as by default;
 *  `invisible` also takes them out of the tab order and the accessibility
 *  tree. */
const LAYERS = {
  default: {
    slot: 'flex items-center justify-end',
    rest: { idle: 'flex swap-shown:hidden', revealed: 'hidden' },
    actions: {
      idle: 'hidden swap-shown:flex transition-[opacity,translate] starting:translate-x-2 starting:opacity-0',
      revealed: 'flex',
    },
  },
  reserve: {
    slot: 'grid justify-items-end',
    rest: { idle: 'flex swap-shown:invisible', revealed: 'invisible' },
    actions: {
      idle: 'flex invisible translate-x-2 opacity-0 transition-none swap-shown:visible swap-shown:translate-x-0 swap-shown:opacity-100 swap-shown:transition-[opacity,translate,visibility]',
      revealed: 'flex',
    },
  },
} as const;

/**
 * The trailing end of a sidebar row: quiet values at rest, the row's actions on
 * hover or keyboard focus. By default whichever shows takes the room, the other
 * none: at rest the actions reserve nothing and the label runs up to `rest`; on
 * hover the label gives way to the actions (B2). `reserve` keeps the room of
 * the wider of the two, so nothing beside it moves (the task card's last
 * column: its name keeps one width, T24, T26). The row must carry the
 * `group/swap` class.
 */
export function HoverSwapSlot({
  rest,
  actions,
  revealed = false,
  reserve = false,
}: HoverSwapSlotProps) {
  const layers = LAYERS[reserve ? 'reserve' : 'default'];
  const state = revealed ? 'revealed' : 'idle';
  // A reserved slot stacks both layers in its one cell.
  const cell = reserve && 'col-start-1 row-start-1';
  return (
    <div className={cn('group/slot shrink-0', layers.slot)}>
      {rest && <div className={cn('items-center', cell, layers.rest[state])}>{rest}</div>}
      <div
        className={cn(
          'items-center gap-0.5 duration-calm ease-settle',
          cell,
          layers.actions[state],
        )}
      >
        {actions}
      </div>
    </div>
  );
}
