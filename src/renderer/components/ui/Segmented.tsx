import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { CountBadge } from './CountBadge';
import { focusRing } from './styles';
import { Tooltip } from './Tooltip';

const segmentVariants = cva(
  cn(
    'flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2.5 font-medium text-ink-2 transition-colors duration-150 hover:text-ink aria-checked:bg-select aria-checked:text-ink [&_svg]:shrink-0',
    focusRing,
  ),
  {
    variants: {
      size: { sm: 'h-6 text-sm', md: 'h-7 text-sm' },
      fullWidth: { true: 'flex-1', false: '' },
    },
  },
);

/**
 * Pill tabs: a row of mutually exclusive options, the selected one on a select
 * tint. No track, no border — tone carries it. Use it for view switches
 * (settings tabs, a list's filter) and small option sets.
 */
export function Segmented<T extends string | number | null>({
  value,
  options,
  onChange,
  fullWidth = true,
  size = 'md',
  segmentClassName,
  'aria-label': ariaLabel,
}: {
  value: T;
  options: Array<{
    value: T;
    label: string;
    icon?: React.ReactNode;
    count?: number;
    /** After the label, quieter ("· 5 open"); omitted when empty. */
    summary?: string;
    /** Greyed out and inert; `title` says why (its tooltip still shows). */
    disabled?: boolean;
    /** Tooltip text. */
    title?: string;
  }>;
  onChange: (v: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  /** Layout only: e.g. a container query that tightens the padding as the
   *  row narrows (labels truncate; they never fold to icons). */
  segmentClassName?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('gap-0.5', fullWidth ? 'flex w-full' : 'inline-flex max-w-full')}
    >
      {options.map((opt) => {
        const segment = (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={opt.value === value}
            aria-disabled={opt.disabled || undefined}
            onClick={opt.disabled ? undefined : () => onChange(opt.value)}
            className={cn(
              segmentVariants({ size, fullWidth }),
              opt.disabled && 'opacity-40 hover:text-ink-2',
              segmentClassName,
            )}
          >
            {opt.icon && <span className="flex">{opt.icon}</span>}
            <span className="truncate">{opt.label}</span>
            {opt.summary && (
              <span className="type-caption shrink-0 tabular-nums">· {opt.summary}</span>
            )}
            {opt.count != null && <CountBadge count={opt.count} />}
          </button>
        );
        return opt.title ? (
          <Tooltip key={String(opt.value)} content={opt.title}>
            {segment}
          </Tooltip>
        ) : (
          segment
        );
      })}
    </div>
  );
}
