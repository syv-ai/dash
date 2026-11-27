import * as React from 'react';
import { cn } from '../../lib/cn';
import { buttonVariants } from './Button';
import { focusRing, pressedTint } from './styles';
import { Tooltip, type TooltipContent } from './Tooltip';

/** A rail's width (px), both sidebars': the app sidebar's collapsed panel,
 *  the task sidebar's, and its list column folded (it folds to the rail,
 *  never to nothing). As wide as its figures need ("100%", "Weekly", a
 *  session's ring) whatever the window's. */
export const RAIL_PX = 48;

/**
 * A collapsed sidebar's rail: its items stacked from the top, centred, its
 * `footer` at the foot, and its own space one button under them (`label`,
 * its tooltip `tooltip`), so a click between or below the items still does
 * the rail's job (shows the sidebar). The space tints on hover; an item
 * hovered tints alone.
 */
export function Rail({
  label,
  tooltip,
  onClick,
  children,
  footer,
}: {
  /** The space's accessible name. */
  label: string;
  /** The space's tooltip (its title, shortcut). */
  tooltip: TooltipContent;
  onClick: () => void;
  /** `RailItem`s and other figures, top to bottom. */
  children: React.ReactNode;
  /** Actions at the foot (`IconButton`s), top to bottom. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative h-full w-full">
      <Tooltip content={tooltip} side="left">
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn('absolute inset-0 rounded-lg transition-colors hover:bg-hover', focusRing)}
        />
      </Tooltip>
      {/* Over the space, letting its clicks through but for the items'. */}
      <div className="pointer-events-none relative flex h-full w-full flex-col items-center px-0.5 pt-4 pb-1">
        <div className="flex w-full flex-col items-center gap-3 *:pointer-events-auto">
          {children}
        </div>
        {footer && (
          <div className="mt-auto flex flex-col items-center gap-0.5 pt-3 *:pointer-events-auto">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One item on a `Rail`: a figure (a count, an icon over one) as wide as the
 * rail, its tooltip saying what it is and where a click leads. With no
 * `onClick` it is a figure only (its tooltip still shows).
 */
export function RailItem({
  tooltip,
  side = 'left',
  'aria-label': ariaLabel,
  pressed,
  onClick,
  children,
}: {
  tooltip: TooltipContent;
  /** Where its tooltip opens: away from the window's edge the rail is on
   *  (`left` for the task sidebar's, `right` for the app sidebar's). */
  side?: 'left' | 'right';
  'aria-label'?: string;
  /** The current item (the selected task): `pressedTint` and aria-pressed. */
  pressed?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={tooltip} side={side}>
      {onClick ? (
        <RailItemButton aria-label={ariaLabel} pressed={pressed} onClick={onClick}>
          {children}
        </RailItemButton>
      ) : (
        <div aria-label={ariaLabel} className={cn('cursor-default', ITEM_LAYOUT)}>
          {children}
        </div>
      )}
    </Tooltip>
  );
}

const ITEM_LAYOUT = 'flex w-full flex-col items-center gap-0.5 py-1';

/**
 * A `RailItem`'s button alone, without its tooltip: spreads its props and ref
 * onto the `<button>`, so it can be the `asChild` target of a Radix trigger
 * (a popover the item opens), under the caller's own `Tooltip side="left"`.
 */
export function RailItemButton({
  pressed,
  className,
  ...props
}: React.ComponentProps<'button'> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'h-auto px-0',
        ITEM_LAYOUT,
        pressed && pressedTint,
        className,
      )}
      {...props}
    />
  );
}
