import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { menuItem, menuSeparator } from './styles';

/**
 * shadcn Command over `cmdk`: the searchable, groupable list behind comboboxes
 * (inside `PopoverContent`) and the ⌘K palette. Transparent itself; the
 * surrounding surface supplies the raised background.
 */
export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn('flex h-full w-full flex-col overflow-hidden text-ink', className)}
      {...props}
    />
  );
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 px-3" cmdk-input-wrapper="">
      <Search size={14} strokeWidth={1.8} className="shrink-0 text-ink-3" />
      <CommandPrimitive.Input
        className={cn(
          'flex h-10 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-65 overflow-y-auto overflow-x-hidden p-1.5', className)}
      {...props}
    />
  );
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-6 text-center text-sm text-ink-3" {...props} />;
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden text-ink **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-1.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:type-subheading',
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn(menuSeparator, className)} {...props} />;
}

/** cmdk marks the active row with data-selected (Radix menus use data-highlighted). */
export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        menuItem,
        'data-[selected=true]:bg-select data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
        className,
      )}
      {...props}
    />
  );
}
