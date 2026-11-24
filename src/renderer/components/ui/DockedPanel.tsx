import * as React from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * A bar docked at the bottom of a column that opens upward over it: a title
 * and a quiet summary ("· 5 open · 2 drafts") on a toggle row, and, open, its
 * content scrolling inside, capped at three fifths of the column's height so
 * what it sits under stays in reach. Controlled: the owner keeps `open`.
 * Mount it as the last child of a full-height flex column.
 */
export function DockedPanel({
  title,
  summary,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  /** Beside the title, quieter; omitted when empty. */
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section
      className={cn('flex shrink-0 flex-col border-t border-line bg-ground', open && 'max-h-3/5')}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-left transition-colors hover:bg-hover',
          focusRing,
        )}
      >
        <ChevronUp
          size={14}
          strokeWidth={1.8}
          className={cn('shrink-0 text-icon transition-transform', open && 'rotate-180')}
          aria-hidden
        />
        <span className="type-heading shrink-0">{title}</span>
        {summary && <span className="type-caption min-w-0 truncate tabular-nums">· {summary}</span>}
      </button>
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
