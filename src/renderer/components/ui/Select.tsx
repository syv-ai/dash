import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  renderOption?: (option: SelectOption<T>) => React.ReactNode;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  renderOption,
  placeholder,
  className = '',
  contentClassName = '',
}: SelectProps<T>) {
  const selected = options.find((o) => o.value === value);
  const render = renderOption ?? ((o: SelectOption<T>) => o.label);

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-[12px] border border-border/60 bg-transparent text-foreground hover:border-border focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors data-[state=open]:border-primary/40 data-[state=open]:ring-1 data-[state=open]:ring-primary/40 ${className}`}
        >
          <span className="truncate text-left">
            {selected ? render(selected) : (placeholder ?? ' ')}
          </span>
          <ChevronDown
            size={13}
            strokeWidth={1.8}
            className="opacity-60 shrink-0 transition-transform duration-150 data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className={`z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] max-h-[320px] overflow-y-auto p-1 rounded-lg border border-border/60 shadow-xl shadow-black/30 outline-none animate-popover-in ${contentClassName}`}
          style={{
            background: 'hsl(var(--popover))',
            color: 'hsl(var(--popover-foreground))',
          }}
        >
          <DropdownMenuPrimitive.RadioGroup
            value={value}
            onValueChange={(v) => onValueChange(v as T)}
          >
            {options.map((opt) => (
              <DropdownMenuPrimitive.RadioItem
                key={opt.value}
                value={opt.value}
                className="relative w-full flex items-center justify-between gap-2 pl-2.5 pr-2 py-1.5 rounded text-[12px] cursor-default outline-none transition-colors data-[highlighted]:bg-accent text-foreground/85 data-[state=checked]:text-foreground"
              >
                <span className="truncate text-left">{render(opt)}</span>
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check size={12} strokeWidth={2} className="text-primary shrink-0" />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
