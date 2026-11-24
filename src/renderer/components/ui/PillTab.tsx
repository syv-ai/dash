import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

const pillTabVariants = cva(
  cn(
    'group/tab relative flex h-6 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md px-2.5 select-none transition-colors duration-150',
    focusRing,
  ),
  {
    variants: {
      // Plain on the select tint when active; `primary` (Dash speaking, e.g. a
      // wizard) and `service` (a dev server) carry a wash of their own.
      tone: { plain: '', primary: '', service: '' },
      active: { true: 'text-ink', false: 'text-ink-2 hover:text-ink' },
      // The active tab of a group that isn't focused: marked, but quieter.
      muted: { true: '', false: '' },
    },
    compoundVariants: [
      { tone: 'plain', active: true, className: 'bg-select' },
      { tone: 'plain', active: false, className: 'hover:bg-hover' },
      { tone: 'primary', active: true, className: 'bg-primary/20' },
      { tone: 'primary', active: false, className: 'bg-primary/10 hover:bg-primary/15' },
      { tone: 'service', active: true, className: 'bg-terminal-service/25' },
      {
        tone: 'service',
        active: false,
        className: 'bg-terminal-service/10 hover:bg-terminal-service/15',
      },
      { tone: 'plain', active: true, muted: true, className: 'bg-hover' },
    ],
    defaultVariants: { tone: 'plain', active: false, muted: false },
  },
);

export type PillTabProps = Omit<React.ComponentProps<'div'>, 'onSelect'> &
  VariantProps<typeof pillTabVariants> & {
    onSelect: () => void;
    /** Closeable: a × on hover, and a middle-click closes too. */
    onClose?: () => void;
    /** The ×'s accessible name, e.g. "Close terminal 2". */
    closeLabel?: string;
    /** A mark beside the label (a live or dirty dot); the × covers it on hover. */
    indicator?: React.ReactNode;
  };

/**
 * A tab in a strip of open things (terminals, files): a pill, the Segmented
 * look, with an optional indicator and a hover ×. The strip owns layout.
 */
export const PillTab = React.forwardRef<HTMLDivElement, PillTabProps>(function PillTab(
  { tone, active, muted, onSelect, onClose, closeLabel, indicator, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={0}
      aria-selected={!!active}
      className={cn(pillTabVariants({ tone, active, muted }), className)}
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
      {/* The label and its indicator are centred together; the × floats in
          the right gutter so it never shifts them. */}
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
          className="absolute top-1/2 right-1 hidden size-3.5 -translate-y-1/2 items-center justify-center rounded-sm text-ink-3 transition-colors group-hover/tab:flex hover:bg-hover hover:text-ink"
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
