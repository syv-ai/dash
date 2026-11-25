import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * The title row of a sidebar or panel: a quiet title (a group label) on the left, icon
 * actions on the right, 44px tall. No rule under it — tone separates.
 */
export function PanelHeader({
  title,
  actions,
  className,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  /** Layout only (padding to align with the panel's rows). */
  className?: string;
}) {
  return (
    <div className={cn('flex h-11 shrink-0 items-center gap-1 pl-3 pr-2', className)}>
      <h2 className="type-subheading min-w-0 flex-1 truncate">{title}</h2>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
