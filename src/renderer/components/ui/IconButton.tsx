import * as React from 'react';
import { cn } from '../../lib/cn';
import { buttonVariants } from './Button';
import { Tooltip } from './Tooltip';

interface IconButtonProps extends Omit<React.ComponentProps<'button'>, 'title'> {
  /** Tooltip text, also the accessible name (not a native title, which would double up). */
  title: string;
  /** default and muted: icon at rest, ink on hover; destructive: fail on hover. */
  variant?: 'default' | 'destructive' | 'muted';
  /** md = a 30px square (`Button size="icon"`), sm = 24px for dense rows. */
  size?: 'sm' | 'md';
  /**
   * Greyed out and inert, its tooltip still shown (a disabled `<button>` gets
   * no mouse events, so its tooltip couldn't say why it is off).
   */
  disabled?: boolean;
  /** A toggle that is on (or the current item in a rail): select tint, ink,
   *  and aria-pressed. Leave undefined for a plain button. */
  pressed?: boolean;
  children: React.ReactNode;
}

// `muted` is kept for existing call sites; it now reads the same as `default`.
const variantStyles = {
  default: 'text-icon hover:bg-hover hover:text-ink',
  muted: 'text-icon hover:bg-hover hover:text-ink',
  destructive: 'text-icon hover:bg-state-fail/12 hover:text-state-fail',
} as const;

/** Rest state with the hover feedback removed, for `disabled`. */
const DISABLED = 'opacity-40 hover:bg-transparent hover:text-icon';

const PRESSED = 'bg-select text-ink hover:bg-select';

/**
 * Icon-only button: `Button size="icon"` plus a required tooltip label, which
 * is also its aria-label. Spreads extra props and its ref onto the `<button>`,
 * so it can be the `asChild` target of a Radix trigger (dropdown menu, popover).
 */
export function IconButton({
  onClick,
  title,
  variant = 'default',
  size = 'md',
  className,
  disabled = false,
  pressed,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={title}>
      <button
        type="button"
        aria-label={title}
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled || undefined}
        aria-pressed={pressed}
        className={cn(
          buttonVariants({ variant: 'ghost', size: size === 'sm' ? 'icon-sm' : 'icon' }),
          variantStyles[variant],
          pressed && PRESSED,
          disabled && DISABLED,
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
