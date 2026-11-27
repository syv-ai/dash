import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tooltip } from './Tooltip';

/**
 * The button. Variants: primary (the one neutral CTA), secondary (a quiet tint),
 * ghost (bare until hovered), destructive (a fail tint). Icon-only actions use
 * `IconButton`, which adds the required tooltip on top of `size="icon"`.
 * shadcn Button API, including `asChild`.
 */
export const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,opacity] disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary: 'bg-btn text-btn-ink hover:opacity-88',
        secondary: 'bg-hover text-ink hover:bg-select',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
        destructive: 'bg-state-fail/12 text-state-fail hover:bg-state-fail/20',
      },
      size: {
        // A count with its icon inside a dense row (a file tree's notes).
        xs: 'h-5 gap-0.5 px-1 text-xs',
        sm: 'h-6.5 px-2.5 text-sm',
        md: 'h-7.5 px-3 text-sm',
        icon: 'size-7.5',
        'icon-sm': 'size-6',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (a link, a Radix trigger) with the button's styling. */
    asChild?: boolean;
    /** Disabled, and why, in a tooltip on a wrapper (a disabled `<button>`
     *  gets no mouse events, so it couldn't show one itself). */
    disabledReason?: string | null;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  disabledReason,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  const button = (
    <Comp
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || !!disabledReason}
      {...props}
    />
  );
  if (!disabledReason) return button;
  return (
    <Tooltip content={disabledReason}>
      <span tabIndex={0} className={cn('inline-flex rounded-md', focusRing)}>
        {button}
      </span>
    </Tooltip>
  );
}
