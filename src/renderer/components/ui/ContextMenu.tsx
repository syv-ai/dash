import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Kbd } from './Kbd';
import {
  menuItem,
  menuItemDestructive,
  radixMenuItemStates,
  menuLabel,
  menuSeparator,
  menuSurface,
} from './styles';

/**
 * Dash's right-click menu (Radix, shadcn API), the same surface, rows and
 * separators as DropdownMenu. The Trigger wraps the area that answers
 * right-click; the menu opens at the pointer, or under the trigger from the
 * keyboard (the context-menu key, or Shift+F10). It stacks above modals
 * (z-70) since rows inside dialogs use it.
 *
 * Compose rows by hand, or declare them with `ContextMenuItems`.
 */
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuGroup = ContextMenuPrimitive.Group;

/** The context-menu key, or Shift+F10 (the platforms' keyboard "right-click"). */
function isMenuKey(e: KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

/** Opens the menu from the keyboard: a `contextmenu` at the trigger's
 *  bottom-left, which Radix takes as a right-click there. Only when the
 *  trigger itself has focus, so an editor inside it keeps its own keys. */
function openFromKeyboard(e: KeyboardEvent) {
  const el = e.currentTarget as HTMLElement;
  if (e.defaultPrevented || e.target !== el || !isMenuKey(e)) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: r.left + 8,
      clientY: r.bottom,
    }),
  );
}

export const ContextMenuTrigger = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>
>(function ContextMenuTrigger(props, forwardedRef) {
  // A native listener, not an `onKeyDown` prop: with `asChild`, a child that
  // sets its own onKeyDown after spreading props (Tab, TreeRow) would drop it.
  const [node, setNode] = React.useState<HTMLSpanElement | null>(null);
  const ref = React.useCallback(
    (el: HTMLSpanElement | null) => {
      setNode(el);
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );
  React.useEffect(() => {
    if (!node) return;
    node.addEventListener('keydown', openFromKeyboard);
    return () => node.removeEventListener('keydown', openFromKeyboard);
  }, [node]);
  return <ContextMenuPrimitive.Trigger ref={ref} {...props} />;
});

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
  variant = 'default',
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  /** `destructive`: a row that deletes, in the fail colour. */
  variant?: 'default' | 'destructive';
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        menuItem,
        radixMenuItemStates,
        variant === 'destructive' && menuItemDestructive,
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return <ContextMenuPrimitive.Label className={cn(menuLabel, className)} {...props} />;
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn(menuSeparator, className)} {...props} />;
}

/** A keyboard hint at a row's end. */
export function ContextMenuShortcut({ className, ...props }: React.ComponentProps<typeof Kbd>) {
  return <Kbd className={cn('ml-auto', className)} {...props} />;
}

/** One row of a declared menu. */
export interface ContextMenuAction {
  label: string;
  /** A lucide icon (drawn at 14px), or a ready element (a brand mark). */
  icon?: LucideIcon | React.ReactElement;
  /** Shown at the row's end (the row doesn't bind it). */
  shortcut?: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** A row, a separator, or nothing (a falsy entry drops out, for rows that
 *  only sometimes apply). */
export type ContextMenuEntry = ContextMenuAction | 'separator' | false | null | undefined;

/** A menu's rows declared as data: `<ContextMenuItems items={[…]} />`.
 *  When some rows have an icon, the rest keep its slot so labels line up. */
export function ContextMenuItems({ items }: { items: readonly ContextMenuEntry[] }) {
  const iconSlot = items.some((item) => item && item !== 'separator' && item.icon);
  return (
    <>
      {items.map((item, i) => {
        if (!item) return null;
        if (item === 'separator') return <ContextMenuSeparator key={`separator-${i}`} />;
        const { icon: Icon } = item;
        return (
          <ContextMenuItem
            key={item.label}
            variant={item.destructive ? 'destructive' : 'default'}
            disabled={item.disabled}
            onSelect={item.onSelect}
          >
            {React.isValidElement(Icon) ? (
              Icon
            ) : Icon ? (
              <Icon size={14} strokeWidth={1.8} />
            ) : (
              iconSlot && <span aria-hidden className="size-3.5 shrink-0" />
            )}
            {item.label}
            {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
          </ContextMenuItem>
        );
      })}
    </>
  );
}
