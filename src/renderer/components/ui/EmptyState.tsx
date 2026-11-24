import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * What an empty list or pane shows: an icon, one line, an optional action,
 * centred in ink-3.
 */
export function EmptyState({
  icon,
  title,
  action,
  className,
}: {
  /** A lucide icon at 14px/1.8, like everywhere else. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
  /** Layout only. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-3',
        className,
      )}
    >
      {icon}
      <p>{title}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
