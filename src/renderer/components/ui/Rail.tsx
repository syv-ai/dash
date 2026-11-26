import * as React from 'react';
import { cn } from '../../lib/cn';
import { buttonVariants } from './Button';
import { focusRing } from './styles';
import { Tooltip, type TooltipContent } from './Tooltip';

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
          className={cn(
            'absolute inset-0 rounded-lg transition-colors duration-150 hover:bg-hover',
            focusRing,
          )}
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
  'aria-label': ariaLabel,
  onClick,
  children,
}: {
  tooltip: TooltipContent;
  'aria-label'?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={tooltip} side="left">
      {onClick ? (
        <RailItemButton aria-label={ariaLabel} onClick={onClick}>
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
export function RailItemButton({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: 'ghost' }), 'h-auto px-0', ITEM_LAYOUT, className)}
      {...props}
    />
  );
}
