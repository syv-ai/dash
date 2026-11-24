import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/**
 * The badge base: a small rounded-sm tag. `neutral` is the hover tint; the
 * state tones tint by agent state; `bare` has no fill (icon or text marks).
 * `CountBadge`, `TokenBadge`, `MainRepoBadge` and `PrBadge` build on it.
 */
export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm font-medium tabular-nums [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-hover text-ink-2',
        bare: 'text-ink-3',
        needs: 'bg-state-needs/12 text-state-needs',
        fail: 'bg-state-fail/12 text-state-fail',
        work: 'bg-state-work/12 text-state-work',
        done: 'bg-state-done/12 text-state-done',
      },
      size: {
        sm: 'h-4 px-1 text-xs',
        md: 'h-5 px-1.5 text-xs',
        icon: 'size-4.5 justify-center',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
