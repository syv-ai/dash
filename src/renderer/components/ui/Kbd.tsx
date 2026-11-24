import * as React from 'react';
import { cn } from '../../lib/cn';

/** A key or shortcut hint (⌘K): quiet ink-3 on the hover tint. */
export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4.5 min-w-4.5 items-center justify-center gap-0.5 rounded-sm bg-hover px-1 font-sans text-xs font-medium text-ink-3',
        className,
      )}
      {...props}
    />
  );
}
