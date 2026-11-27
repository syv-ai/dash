import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing, menuItem, menuSurface, radixMenuItemStates } from './styles';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Sets the label in this font, to preview it (a terminal font picker). */
  fontFamily?: string;
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
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'group/select flex h-7.5 w-full items-center justify-between gap-2 rounded-md bg-hover px-2.5 text-sm text-ink transition-colors hover:bg-select data-[state=open]:bg-select',
            focusRing,
            className,
          )}
        >
          <span className="truncate text-left">
            {selected ? render(selected) : (placeholder ?? ' ')}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className="shrink-0 text-icon transition-transform duration-150 group-data-[state=open]/select:rotate-180"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className={cn(
            menuSurface,
            'max-h-80 min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto',
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
                className={cn(menuItem, radixMenuItemStates, 'justify-between')}
              >
                <span className="truncate text-left">{render(opt)}</span>
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
