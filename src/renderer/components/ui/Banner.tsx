import * as React from 'react';
import { X } from 'lucide-react';
import type { PrState } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';
import { prStatusTint } from './prStatusColors';

/**
 * A mode the surface is in, said in a band across it with its way out: an
 * optional leading icon, the label, and a ✕ that ends it (its tooltip names
 * what ✕ does). Neutral (the select tint) or, with `tone`, a PR state's
 * GitHub colour as a tint with its text; icon and ✕ take the text's colour.
 * 32px high, rounded-lg as a row.
 */
export function Banner({
  icon,
  children,
  dismissLabel,
  onDismiss,
  tone,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** The ✕'s tooltip and accessible name. */
  dismissLabel: string;
  onDismiss: () => void;
  /** A PR's state, in its colour; neutral without. */
  tone?: PrState | null;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-select pr-1 pl-2.5 text-sm font-medium text-ink [&_svg]:shrink-0',
        tone && prStatusTint(tone),
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <IconButton
        size="sm"
        title={dismissLabel}
        onClick={onDismiss}
        className="text-current hover:bg-current/10 hover:text-current"
      >
        <X size={14} strokeWidth={1.8} />
      </IconButton>
    </div>
  );
}
