import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/cn';

/** The window's top strip doubles as the macOS titlebar drag region; keep
 *  tooltips out of it so a header button's tooltip flips below. */
const COLLISION_PADDING = { top: 40, right: 8, bottom: 8, left: 8 };

interface TooltipProps {
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Hover delay in ms before the tooltip shows. */
  delay?: number;
  /** Controlled visibility (e.g. pinned open in the primitives gallery). */
  open?: boolean;
  /** One element; it becomes the trigger (Radix `asChild`), so it must forward
   *  its ref and spread props — a Radix trigger or `IconButton` both do. */
  children: React.ReactElement;
}

/**
 * Hover label for a control (Radix Tooltip, shadcn look): raised, small,
 * rounded-md. Long text wraps at a readable width and honours `\n`. Opens on
 * hover after `delay`, and on keyboard focus — not on programmatic focus, so a
 * dialog that autofocuses a button doesn't pop its tooltip.
 *
 * Wrapping another Radix trigger (`<Tooltip><PopoverTrigger asChild>…`) works,
 * but the tooltip's `data-state` wins on the shared element: style the open
 * state with `aria-expanded:` rather than `data-[state=open]:`.
 */
export function Tooltip({ content, side = 'top', delay = 1000, open, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={300}>
      <TooltipPrimitive.Root open={open}>
        <TooltipPrimitive.Trigger
          asChild
          onFocus={(e) => {
            // Radix skips its own focus handler when this one prevents default.
            if (!e.currentTarget.matches(':focus-visible')) e.preventDefault();
          }}
        >
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={COLLISION_PADDING}
        className={cn(
          'z-[9999] w-max max-w-70 whitespace-pre-line break-words rounded-md bg-raised px-2 py-1 text-xs text-ink shadow-raised animate-tooltip-in',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
