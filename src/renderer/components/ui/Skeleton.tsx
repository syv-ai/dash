import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const skeletonVariants = cva('bg-select motion-safe:animate-skeleton', {
  variants: {
    /** `block`: a control or a line of text (`rounded-md`); `circle`: a ring
     *  or an avatar. */
    shape: { block: 'rounded-md', circle: 'rounded-full' },
  },
  defaultVariants: { shape: 'block' },
});

/**
 * A placeholder the size of what is still loading (shadcn's Skeleton, on
 * Dash's tokens): a block in the `select` tint, which reads on every surface
 * (ground, well, raised) in both themes, pulsing slowly (`animate-skeleton`)
 * and holding still under reduced motion. Give it the final element's size
 * and shape (`size-16` `circle` for a ring, `h-4 w-12` for a line of text),
 * so nothing shifts when the content replaces it.
 *
 * Mount it only while the content is on its way, and give a value that may
 * never come a deadline: the pulse runs for as long as the skeleton is
 * mounted.
 */
export function Skeleton({
  shape,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  shape?: 'block' | 'circle';
  /** Size and layout only. */
  className?: string;
}) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(skeletonVariants({ shape }), className)}
      {...props}
    />
  );
}
