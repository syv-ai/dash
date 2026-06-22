import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';

/**
 * shadcn-style Command primitive — a thin wrapper over `cmdk`, styled with
 * Dash's HSL tokens. This is the searchable, groupable list that powers the
 * Combobox pattern (compose it inside our Radix `Popover`). Background/text
 * come from the surrounding PopoverContent (which sets --popover), so Command
 * itself stays transparent.
 */
export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className = '', ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={`flex h-full w-full flex-col overflow-hidden rounded-lg text-foreground ${className}`}
    {...props}
  />
));
Command.displayName = 'Command';

export const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className = '', ...props }, ref) => (
  <div className="flex items-center gap-2 px-3 border-b border-border/60" cmdk-input-wrapper="">
    <Search size={13} strokeWidth={1.8} className="text-muted-foreground/40 shrink-0" />
    <CommandPrimitive.Input
      ref={ref}
      className={`flex h-9 w-full bg-transparent py-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  </div>
));
CommandInput.displayName = 'CommandInput';

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className = '', ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={`max-h-[260px] overflow-y-auto overflow-x-hidden p-1.5 ${className}`}
    {...props}
  />
));
CommandList.displayName = 'CommandList';

export const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-[12px] text-muted-foreground/50"
    {...props}
  />
));
CommandEmpty.displayName = 'CommandEmpty';

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className = '', ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={`overflow-hidden text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground/55 ${className}`}
    {...props}
  />
));
CommandGroup.displayName = 'CommandGroup';

export const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className = '', ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={`my-1 h-px bg-border/60 ${className}`}
    {...props}
  />
));
CommandSeparator.displayName = 'CommandSeparator';

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className = '', ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] cursor-pointer select-none outline-none data-[selected=true]:bg-accent/70 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 ${className}`}
    {...props}
  />
));
CommandItem.displayName = 'CommandItem';
