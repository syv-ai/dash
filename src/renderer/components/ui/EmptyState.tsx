import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * What an empty list or pane shows: an icon (or a larger illustration), one
 * line, an optional second line and action, centred: the title in
 * `type-body`, the rest in ink-2 (ink-3 sank into the dark ground).
 */
export function EmptyState({
  icon,
  illustration: Illustration,
  title,
  description,
  action,
  className,
}: {
  /** A lucide icon at 14px/1.8, like everywhere else. */
  icon?: React.ReactNode;
  /** In place of `icon`, where the pane is the view's whole body: a lucide
   *  icon drawn at 36px, thin, in ink-3, with more room under it. */
  illustration?: LucideIcon;
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
        Illustration && 'gap-4',
        className,
      )}
    >
      {Illustration ? <Illustration size={36} strokeWidth={1.4} className="text-ink-3" /> : icon}
      <div className="grid gap-1">
        <p className="type-body">{title}</p>
        {description && <div>{description}</div>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
