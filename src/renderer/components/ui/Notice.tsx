import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * A quiet note inside a surface, saying why it reads as it does (a checkout
 * that differs from the PR): neutral, a leading icon, text that wraps.
 * Unlike `Banner` it names no mode and has no way out. Rounded-lg as a row.
 */
export function Notice({
  icon,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'p'>, 'children'> & {
  /** A lucide icon at 14px/1.8. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p
      role="status"
      className={cn(
        'type-caption flex items-start gap-2 rounded-lg border border-line bg-well px-2.5 py-1.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {icon && <span className="flex h-4 shrink-0 items-center text-icon">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}
