import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * A card: a raised sheet (rounded-xl, hairline) that sets one item apart from
 * the surface it sits on — a comment thread in a list, on the well.
 * `elevated` adds the floating shadow, for a card drawn over other content
 * (a thread over the code). `padding` md (20px) suits one comment; none
 * leaves it to content with its own rows (a header over a body).
 */
export function Card({
  elevated = false,
  padding = 'md',
  className,
  ...props
}: React.ComponentProps<'article'> & { elevated?: boolean; padding?: 'none' | 'md' }) {
  return (
    <article
      className={cn(
        'min-w-0 rounded-xl border border-line bg-raised text-ink',
        elevated && 'shadow-raised',
        padding === 'md' && 'p-5',
        className,
      )}
      {...props}
    />
  );
}
