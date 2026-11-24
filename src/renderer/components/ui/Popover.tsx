import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/cn';
import { menuSurface } from './styles';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

type ContentProps = React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /** Portal target. Defaults to body. Pass a positioned, overflow-hidden
   *  element to clip the popover inside it (useful for scrollable surfaces
   *  like an editor pane). */
  container?: HTMLElement | null;
};

/** A floating panel on the menu surface, unpadded: the content sets its own. */
export function PopoverContent({
  className,
  sideOffset = 8,
  align = 'start',
  container,
  ...props
}: ContentProps) {
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(menuSurface, 'p-0', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export function PopoverArrow({
  width = 14,
  height = 8,
  className,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Arrow>) {
  return (
    <PopoverPrimitive.Arrow
      width={width}
      height={height}
      className={cn('fill-raised', className)}
      {...props}
    />
  );
}
