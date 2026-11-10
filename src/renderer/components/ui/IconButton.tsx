import React from 'react';
import { Tooltip } from './Tooltip';

type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Tooltip text (not a native title, which would double up). */
  title: string;
  variant?: 'default' | 'destructive' | 'muted';
  size?: IconButtonSize;
  className?: string;
  /**
   * Greyed out and inert, its tooltip still shown (a disabled `<button>` gets
   * no mouse events, so its tooltip couldn't say why it is off).
   */
  disabled?: boolean;
  children: React.ReactNode;
}

const variantStyles = {
  default: 'hover:bg-accent text-fg-fade-80 hover:text-foreground',
  destructive: 'hover:bg-destructive/15 text-fg-fade-80 hover:text-destructive',
  /** Header-strip style: muted at rest, like the header's other ghost buttons. */
  muted: 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
} as const;

const sizeStyles = {
  sm: 'p-0.5',
  md: 'p-1.5',
} as const;

/**
 * Tooltip-wrapped icon button. Forwards its ref and spreads any extra button
 * props so it can be the `asChild` target of a Radix trigger (dropdown menu,
 * popover): Radix attaches its pointer handlers, aria and data attributes to
 * the child, and a component that swallowed them would render a dead button.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    onClick,
    title,
    variant = 'default',
    size = 'md',
    className = '',
    disabled = false,
    children,
    ...rest
  },
  ref,
) {
  return (
    <Tooltip content={title}>
      <button
        ref={ref}
        type="button"
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled || undefined}
        className={`rounded-md transition-colors duration-150 ${sizeStyles[size]} ${
          disabled ? 'cursor-default text-fg-fade-40' : variantStyles[variant]
        } ${className}`}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
