import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Canonical text/CTA button. Icon-only actions use `IconButton`; binary toggles
 * use `Switch`. Variants are themed to Dash's tokens (primary = moonlight CTA,
 * secondary = quiet outline, ghost = bare). Based on the shadcn Button API.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--surface-2))]',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:brightness-110',
        secondary:
          'border border-border/60 text-foreground/80 hover:bg-accent hover:text-foreground hover:border-border',
        ghost: 'text-foreground/70 hover:bg-accent hover:text-foreground',
      },
      size: {
        sm: 'gap-1 rounded-lg px-2.5 py-1 text-[11px]',
        md: 'gap-2 rounded-lg px-4 py-2 text-[13px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`${buttonVariants({ variant, size })} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
