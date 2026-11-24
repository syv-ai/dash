import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '../../lib/cn';
import { menuItem, radixMenuItemStates, menuSeparator, menuSurface } from './styles';

/**
 * Right-click menu, the same surface, rows and separators as DropdownMenu.
 * The Trigger wraps the area that answers right-click; the menu opens at the
 * pointer. It stacks above modals (z-70) since rows inside dialogs use it.
 */
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(menuSurface, 'z-[70] min-w-40', className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(menuItem, radixMenuItemStates, className)}
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn(menuSeparator, className)} {...props} />;
}
