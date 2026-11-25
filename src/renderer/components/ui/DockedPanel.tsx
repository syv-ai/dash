import * as React from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';
import { Segmented } from './Segmented';

/**
 * A bar docked at the bottom of a column that opens upward over it: a toggle
 * and its tabs, each with a quiet summary ("Comments · 5 open"), on one row;
 * open, the picked tab's content scrolls inside, capped at three fifths of the
 * column's height so what it sits under stays in reach. Picking another tab
 * opens the bar on it; picking the current one folds or unfolds it.
 * Controlled: the owner keeps `open` and `tab`. Mount it as the last child of
 * a full-height flex column.
 */
export function DockedPanel<T extends string>({
  tabs,
  tab,
  onTabChange,
  open,
  onOpenChange,
  'aria-label': ariaLabel,
  children,
}: {
  tabs: { value: T; label: string; summary?: string }[];
  tab: T;
  onTabChange: (tab: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  'aria-label': string;
  /** The picked tab's content. */
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section
      aria-label={ariaLabel}
      className={cn('flex shrink-0 flex-col border-t border-line bg-ground', open && 'max-h-3/5')}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 px-1.5">
        <IconButton
          size="sm"
          title={open ? 'Fold' : 'Unfold'}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronUp
            size={14}
            strokeWidth={1.8}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </IconButton>
        <Segmented
          size="sm"
          fullWidth={false}
          aria-label={ariaLabel}
          value={tab}
          options={tabs}
          onChange={(t) => {
            if (t === tab) return onOpenChange(!open);
            onTabChange(t);
            onOpenChange(true);
          }}
        />
      </div>
      {open && (
        <div
          id={id}
          className="scrollbar-gutter-stable scrollbar-thin-hover min-h-0 overflow-y-auto pb-2"
        >
          {children}
        </div>
      )}
    </section>
  );
}
