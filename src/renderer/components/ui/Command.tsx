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
      // The root takes focus only to steer the list's keys (tabIndex -1): no ring.
      className={cn('flex h-full w-full flex-col overflow-hidden text-ink outline-none', className)}
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
      <Search size={14} strokeWidth={1.8} className="shrink-0 text-icon" />
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
  palette,
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List> & {
  /** The ⌘K palette's list: up to 70% of the window's height with its
   *  input (h-10), not a combobox's short list. */
  palette?: boolean;
}) {
  return (
    <CommandPrimitive.List
      className={cn(
        'scrollbar-thin-hover overflow-y-auto overflow-x-hidden p-1.5',
        palette ? 'max-h-[calc(70vh-(--spacing(10)))]' : 'max-h-65',
        className,
      )}
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
        'overflow-hidden text-ink **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:type-subheading',
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

/** cmdk marks the active row with data-selected (Radix menus use data-highlighted).
 *  With a `description` the row takes a second, caption line under its label.
 *  An `entry` row lays out several lines of its own (a PR in the PR list):
 *  taller, roomier, top-aligned, and its icons keep the colour they set (a PR
 *  state icon's, D133), so a resting icon in it takes `text-icon` itself. */
export function CommandItem({
  className,
  description,
  entry = false,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & {
  description?: React.ReactNode;
  entry?: boolean;
}) {
  return (
    <CommandPrimitive.Item
      className={cn(
        menuItem,
        'data-[selected=true]:bg-select data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
        description && 'h-auto flex-col items-stretch gap-0 py-1.5',
        entry && 'h-auto items-start gap-2.5 py-2 [&_svg]:text-current',
        className,
      )}
      {...props}
    >
      {description ? (
        <>
          <span className="flex min-w-0 items-center gap-2">{children}</span>
          <span className="type-caption truncate">{description}</span>
        </>
      ) : (
        children
      )}
    </CommandPrimitive.Item>
  );
}
