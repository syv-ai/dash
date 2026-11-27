import * as React from 'react';
import { cn } from '../../lib/cn';

/** Inline code in running text (a command, a path, an env var): mono in the
 *  `code-ink` rose on a faint tint, a touch smaller than the text around it.
 *  The one inline-code look, in Markdown and in hand-written copy alike. */
export function Code({ className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'rounded-sm bg-select px-1 py-px font-mono text-[0.92em] text-code-ink wrap-anywhere',
        className,
      )}
      {...props}
    />
  );
}
