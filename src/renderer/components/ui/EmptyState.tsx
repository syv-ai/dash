import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * What an empty list or pane shows: an icon, one line, an optional second
 * line and action, centred in ink-2 (ink-3 sank into the dark ground).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  /** A lucide icon at 14px/1.8, like everywhere else. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** A quieter line under the title (a status, a hint). */
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Layout only. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-2',
        className,
      )}
    >
      {icon}
      <div className="grid gap-1">
        <p>{title}</p>
        {description && <div>{description}</div>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
