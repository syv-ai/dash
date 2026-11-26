import * as React from 'react';
import { cn } from '../../lib/cn';
import { buttonVariants } from './Button';
import { focusRing } from './styles';
import { Tooltip, type TooltipContent } from './Tooltip';

/**
 * A collapsed sidebar's rail: its items stacked from the top, centred, and
 * its own space one button under them (`label`, its tooltip `tooltip`), so a
 * click between or below the items still does the rail's job (shows the
 * sidebar). The space tints on hover; an item hovered tints alone.
 */
export function Rail({
  label,
  tooltip,
  onClick,
  children,
}: {
  /** The space's accessible name. */
  label: string;
  /** The space's tooltip (its title, shortcut). */
  tooltip: TooltipContent;
  onClick: () => void;
  /** `RailItem`s and other figures, top to bottom. */
  children: React.ReactNode;
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
      <div className="pointer-events-none relative flex w-full flex-col items-center gap-3 px-0.5 pt-4 *:pointer-events-auto">
        {children}
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
  const layout = 'flex w-full flex-col items-center gap-0.5 py-1';
  return (
    <Tooltip content={tooltip} side="left">
      {onClick ? (
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={onClick}
          className={cn(buttonVariants({ variant: 'ghost' }), 'h-auto px-0', layout)}
        >
          {children}
        </button>
      ) : (
        <div aria-label={ariaLabel} className={cn('cursor-default', layout)}>
          {children}
        </div>
      )}
    </Tooltip>
  );
}
