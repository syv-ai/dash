import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { CountBadge } from './CountBadge';
import { focusRing } from './styles';

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
  'aria-label': ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode; count?: number }>;
  onChange: (v: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('gap-0.5', fullWidth ? 'flex w-full' : 'inline-flex max-w-full')}
    >
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={segmentVariants({ size, fullWidth })}
        >
          {opt.icon}
          <span className="truncate">{opt.label}</span>
          {opt.count != null && <CountBadge count={opt.count} />}
        </button>
      ))}
    </div>
  );
}
