import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';

/**
 * Right-click menu, styled to match DropdownMenu (same surface, items and
 * separators) so the two read as one family. The Trigger wraps the area that
 * answers right-click; the menu opens at the pointer.
 */
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className = '', style, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={`z-[70] min-w-40 rounded-lg border border-border/60 p-1 shadow-xl shadow-shade/30 outline-hidden animate-popover-in ${className}`}
      style={{
        background: 'hsl(var(--popover))',
        color: 'hsl(var(--popover-foreground))',
        ...style,
      }}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = 'ContextMenuContent';

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className = '', ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={`relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden transition-colors focus:bg-accent data-highlighted:bg-accent data-disabled:pointer-events-none data-disabled:opacity-50 ${className}`}
    {...props}
  />
));
ContextMenuItem.displayName = 'ContextMenuItem';

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className = '', ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-border/60 ${className}`}
    {...props}
  />
));
ContextMenuSeparator.displayName = 'ContextMenuSeparator';
