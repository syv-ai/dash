import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';

/**
 * A mode the surface is in, said in a pill with its way out: the select tint,
 * an optional leading icon, the label, and a ✕ that ends it (its tooltip
 * names what ✕ does). Control height (26px), rounded-md.
 */
export function Pill({
  icon,
  children,
  dismissLabel,
  onDismiss,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** The ✕'s tooltip and accessible name. */
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        'inline-flex h-6.5 min-w-0 items-center gap-1.5 rounded-md bg-select pl-2.5 text-sm font-medium text-ink [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      <IconButton size="sm" title={dismissLabel} onClick={onDismiss}>
        <X size={14} strokeWidth={1.8} />
      </IconButton>
    </div>
  );
}
