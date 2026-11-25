import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/cn';
import { menuItem, menuLabel, menuSurface } from './styles';

export interface Suggestion {
  value: string;
  label: React.ReactNode;
  /** A leading mark (an Avatar). */
  leading?: React.ReactNode;
}

/**
 * Suggestions under a text field while the person types (an @mention, a
 * completion): a menu-surface list anchored to `children`, which keeps focus.
 * The field owns the keys and the highlighted row (`active`, moved with
 * `nextSuggestion`); a click picks too. Radix Popover, never focused itself.
 */
export function SuggestionMenu({
  open,
  label,
  items,
  active,
  onPick,
  onActiveChange,
  onDismiss,
  children,
}: {
  open: boolean;
  /** A small heading over the list ("People on this PR"). */
  label?: string;
  items: readonly Suggestion[];
  active: number;
  onPick: (value: string) => void;
  onActiveChange: (index: number) => void;
  /** A press outside the anchor and the list. */
  onDismiss: () => void;
  /** The field: it anchors the list. */
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <PopoverPrimitive.Root open={open && items.length > 0}>
      <PopoverPrimitive.Anchor asChild>
        <div className="min-w-0">{children}</div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          // The field keeps focus and the keys.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={onDismiss}
          onEscapeKeyDown={onDismiss}
          className={cn(menuSurface, 'min-w-48 max-w-72')}
        >
          {label && <div className={menuLabel}>{label}</div>}
          <div role="listbox" id={id} aria-label={label}>
            {items.map((item, i) => (
              <div
                key={item.value}
                role="option"
                aria-selected={i === active}
                // Down, not click: a click would blur the field first.
                onPointerDown={(e) => {
                  e.preventDefault();
                  onPick(item.value);
                }}
                onPointerMove={() => i !== active && onActiveChange(i)}
                className={cn(menuItem, i === active && 'bg-hover')}
              >
                {item.leading}
                <span className="min-w-0 truncate">{item.label}</span>
              </div>
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** The row `step` (±1) from `active` among `count`, wrapping round. */
export const nextSuggestion = (active: number, step: 1 | -1, count: number): number =>
  count === 0 ? 0 : (active + step + count) % count;
