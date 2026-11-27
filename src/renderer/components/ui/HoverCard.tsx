import * as React from 'react';
import { cn } from '../../lib/cn';
import { Popover, PopoverAnchor, PopoverContent } from './Popover';

/** What a hover card's anchor spreads on itself to open and close it. */
export interface HoverCardTrigger {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** Open after a short rest; close a beat after the pointer leaves, unless it
 *  went onto the card. */
const OPEN_DELAY_MS = 220;
const CLOSE_DELAY_MS = 80;

/**
 * A card beside its anchor that opens on hover (or keyboard focus) after a
 * short rest and stays open while the pointer is on it: a title, a body, a
 * footer. It never takes focus from the list it hovers over. `trigger`
 * renders the anchor (one element that takes a ref) with the handlers
 * spread on it; `onOpen` runs each time it opens (fetch what it shows).
 * A `footer` (a meta line) stays put under a rule while a long body scrolls.
 */
export function HoverCard({
  trigger,
  onOpen,
  side = 'right',
  footer,
  children,
}: {
  trigger: (handlers: HoverCardTrigger) => React.ReactElement;
  onOpen?: () => void;
  side?: 'right' | 'left' | 'top' | 'bottom';
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const openTimer = React.useRef<number | null>(null);
  const closeTimer = React.useRef<number | null>(null);
  const onOpenRef = React.useRef(onOpen);
  onOpenRef.current = onOpen;

  const cancelTimers = React.useCallback(() => {
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  React.useEffect(() => cancelTimers, [cancelTimers]);

  const scheduleOpen = () => {
    cancelTimers();
    openTimer.current = window.setTimeout(() => {
      setOpen(true);
      onOpenRef.current?.();
    }, OPEN_DELAY_MS);
  };
  const scheduleClose = () => {
    cancelTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const holdOpen = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        {trigger({
          onMouseEnter: scheduleOpen,
          onMouseLeave: scheduleClose,
          onFocus: scheduleOpen,
          onBlur: scheduleClose,
        })}
      </PopoverAnchor>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={10}
        onMouseEnter={holdOpen}
        onMouseLeave={scheduleClose}
        // Hovering must not take focus from the list.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-110 w-105 flex-col"
      >
        <div
          className={cn(
            'scrollbar-thin-hover flex min-h-0 flex-col gap-2.5 overflow-y-auto p-3.5',
            footer && 'pb-2.5',
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="mx-3.5 shrink-0 border-t border-line pt-1.5 pb-3.5">{footer}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
