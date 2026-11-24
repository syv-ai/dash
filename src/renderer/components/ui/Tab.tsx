import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export type TabProps = Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  active?: boolean | null;
  onSelect: () => void;
  /** Closeable: a × on hover, and a middle-click closes too. */
  onClose?: () => void;
  /** The ×'s accessible name, e.g. "Close terminal 2". */
  closeLabel?: string;
  /** A mark beside the label (a live or dirty dot); the × covers it on hover. */
  indicator?: React.ReactNode;
};

/**
 * What every tab shape shares, unstyled: the tab role, Enter/Space to select,
 * middle-click to close, the label with its indicator, and the hover ×. The
 * shapes (`PillTab`, `FolderTab`) give it a `group/tab` class and their look.
 */
export const Tab = React.forwardRef<HTMLDivElement, TabProps>(function Tab(
  { active, onSelect, onClose, closeLabel, indicator, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={0}
      aria-selected={!!active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && onClose) {
          e.preventDefault();
          onClose();
        }
      }}
      {...props}
    >
      {/* The label and its indicator sit together; the × floats in the right
          gutter so it never shifts them. */}
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-sm font-medium">{children}</span>
        {indicator && (
          <span className={cn('flex shrink-0', onClose && 'group-hover/tab:invisible')}>
            {indicator}
          </span>
        )}
      </span>
      {onClose && (
        <button
          type="button"
          aria-label={closeLabel ?? 'Close'}
          className="absolute top-1/2 right-1 hidden size-3.5 -translate-y-1/2 items-center justify-center rounded-sm text-icon transition-colors group-hover/tab:flex hover:bg-hover hover:text-ink"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={10} strokeWidth={2} />
        </button>
      )}
    </div>
  );
});
