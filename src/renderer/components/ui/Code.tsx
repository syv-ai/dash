import * as React from 'react';
import { cn } from '../../lib/cn';

/** Inline code in running text (a command, a path, an env var): mono on a
 *  faint tint, a touch smaller than the text around it. */
export function Code({ className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'rounded-sm bg-select px-1 py-px font-mono text-[0.92em] wrap-anywhere',
        className,
      )}
      {...props}
    />
  );
}
