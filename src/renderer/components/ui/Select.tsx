import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { InfoTip } from './InfoTip';
import { focusRing, menuItem, menuSurface, radixMenuItemStates } from './styles';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Sets the label in this font, to preview it (a terminal font picker). */
  fontFamily?: string;
  /** Shown but not pickable; `disabledReason` says why, behind an ⓘ. */
  disabled?: boolean;
  disabledReason?: string;
}

/** An option's label, in its own font when it previews one. */
function OptionLabel<T extends string>({ option }: { option: SelectOption<T> }) {
  return option.fontFamily ? (
    <span style={{ fontFamily: option.fontFamily }}>{option.label}</span>
  ) : (
    <>{option.label}</>
  );
}

interface SelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  renderOption?: (option: SelectOption<T>) => React.ReactNode;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  'aria-label'?: string;
}

/**
 * Pick one of a few options. The trigger looks like an Input (hover-tint fill,
 * no border); the list is the menu surface. Built on Radix's dropdown radio
 * group rather than Radix Select, which isn't a dependency.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  renderOption,
  placeholder,
  className,
  contentClassName,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const selected = options.find((o) => o.value === value);
  const render = renderOption ?? ((o: SelectOption<T>) => <OptionLabel option={o} />);

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <SelectTrigger aria-label={ariaLabel} className={className}>
          <span className="truncate text-left">
            {selected ? render(selected) : (placeholder ?? ' ')}
          </span>
        </SelectTrigger>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className={cn(
            menuSurface,
            'scrollbar-thin-hover max-h-80 min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto',
            contentClassName,
          )}
        >
          <DropdownMenuPrimitive.RadioGroup
            value={value}
            onValueChange={(v) => onValueChange(v as T)}
          >
            {options.map((opt) => (
              <DropdownMenuPrimitive.RadioItem
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={cn(menuItem, radixMenuItemStates, 'justify-between')}
              >
                <span className="truncate text-left">{render(opt)}</span>
                {/* The disabled row takes no pointer; its ⓘ does. */}
                {opt.disabled && opt.disabledReason && (
                  <InfoTip
                    content={opt.disabledReason}
                    label="Why it is off"
                    side="right"
                    className="pointer-events-auto"
                  />
                )}
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check size={14} strokeWidth={1.8} />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

/**
 * The select's field: an Input-like hover-tint fill, the value, and a chevron
 * that turns while open. On its own it is the trigger of a richer picker (a
 * searchable branch list in a Popover); pass it as the Radix trigger's child.
 */
export function SelectTrigger({ className, children, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'group/select flex h-7.5 w-full items-center justify-between gap-2 rounded-md bg-hover px-2.5 text-sm text-ink transition-colors hover:bg-select disabled:pointer-events-none disabled:opacity-40 aria-expanded:bg-select',
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-icon transition-transform duration-calm group-aria-expanded/select:rotate-180"
      />
    </button>
  );
}
