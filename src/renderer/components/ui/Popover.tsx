import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

type ContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  /** Portal target. Defaults to body. Pass a positioned, overflow-hidden
   *  element to clip the popover inside it (useful for scrollable surfaces
   *  like an editor pane). */
  container?: HTMLElement | null;
};

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  ContentProps
>(({ className = '', sideOffset = 8, align = 'start', container, style, ...props }, ref) => (
  <PopoverPrimitive.Portal container={container ?? undefined}>
    <PopoverPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={`z-50 rounded-lg border border-border/60 shadow-xl shadow-black/30 outline-hidden animate-popover-in ${className}`}
      style={{
        background: 'hsl(var(--popover))',
        color: 'hsl(var(--popover-foreground))',
        ...style,
      }}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';

export const PopoverArrow = React.forwardRef<
  SVGSVGElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Arrow>
>(({ width = 14, height = 8, ...props }, ref) => (
  <PopoverPrimitive.Arrow
    ref={ref}
    width={width}
    height={height}
    style={{
      fill: 'hsl(var(--popover))',
      stroke: 'hsl(var(--border) / 0.6)',
      strokeWidth: 1,
    }}
    {...props}
  />
));
PopoverArrow.displayName = 'PopoverArrow';
