import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { CountBadge } from './CountBadge';
import { focusRing } from './styles';
import { Tooltip, type TooltipContent } from './Tooltip';
import { firstFitting, useFittedDensity } from './useFittedDensity';
import { useReselect } from './useReselect';

/**
 * A pill: one option of a row, the selected one on a select tint, no track or
 * border. `Segmented`'s segments and `ViewTabs`' pill tabs share it.
 */
export const pillVariants = cva(
  cn(
    'flex min-w-0 items-center justify-center rounded-md font-medium transition-colors duration-150 [&_svg]:shrink-0',
    focusRing,
  ),
  {
    variants: {
      size: { sm: 'h-6 text-sm', md: 'h-7 text-sm' },
      fullWidth: { true: 'flex-1', false: '' },
      tight: { true: 'gap-1 px-1.5', false: 'gap-1.5 px-2.5' },
      selected: { true: 'text-ink', false: 'text-ink-2 hover:text-ink' },
      // The selected tint is a `TabIndicator` (`pillIndicator`) the row
      // slides under its pills, not the pill's own.
      indicated: { true: '', false: '' },
    },
    compoundVariants: [{ selected: true, indicated: false, className: 'bg-select' }],
    defaultVariants: { fullWidth: false, tight: false, selected: false, indicated: false },
  },
);

/** The selected pill's tint as a sliding `TabIndicator`. */
export const pillIndicator = 'rounded-md bg-select';

/**
 * How a row of segments gives way as it narrows, in order: it drops the
 * counts (they move into the tooltip), then tightens its padding, and only
 * then truncates the labels.
 */
export type SegmentDensity = 'full' | 'uncounted' | 'tight' | 'truncated';

/** The measured rows, widest first; `truncated` has none (it always fits). */
const measured = ['full', 'uncounted', 'tight'] as const;

/** The first density whose natural width fits `available`; `needs` holds the
 *  natural widths of `measured`, in that order. */
export function fitDensity(available: number, needs: readonly number[]): SegmentDensity {
  return firstFitting(available, needs, measured) ?? 'truncated';
}

/**
 * A segment's tooltip: its `title`; with a count, a card naming what the
 * count counts (`countLabel`) whether or not the badge shows, or, without a
 * `countLabel`, the count added once the badge is gone.
 */
export function segmentTip(
  opt: { label: string; count?: number; countLabel?: string; title?: string },
  countShown: boolean,
): TooltipContent {
  if (opt.count == null) return opt.title;
  if (opt.countLabel) {
    return {
      title: opt.label,
      body: opt.title,
      rows: [{ label: opt.countLabel, value: opt.count }],
    };
  }
  if (countShown) return opt.title;
  return opt.title ? `${opt.title} (${opt.count})` : `${opt.label}: ${opt.count}`;
}

type Option<T> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  /** What `count` counts ("Unresolved"): the tooltip names it. */
  countLabel?: string;
  /** Greyed out and inert; `title` says why (its tooltip still shows). */
  disabled?: boolean;
  /** Tooltip text. */
  title?: string;
};

function SegmentBody<T>({ opt, density }: { opt: Option<T>; density: SegmentDensity }) {
  return (
    <>
      {opt.icon && <span className="flex">{opt.icon}</span>}
      <span className="truncate">{opt.label}</span>
      {opt.count != null &&
        (density === 'full' ? (
          <CountBadge count={opt.count} />
        ) : (
          <span className="sr-only">{opt.count}</span>
        ))}
    </>
  );
}

/**
 * Pill tabs: a row of mutually exclusive options, the selected one on a select
 * tint. No track, no border — tone carries it. Use it for view switches
 * (settings tabs, a list's filter) and small option sets.
 *
 * Fits its width (`SegmentDensity`): an invisible copy of the row at each
 * density is measured, and the row takes the widest that fits. A container
 * query can't do this — the break points depend on the labels and counts.
 */
export function Segmented<T extends string | number | null>({
  value,
  options,
  onChange,
  onReselect,
  fullWidth = true,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  options: Array<Option<T>>;
  onChange: (v: T) => void;
  /** A double click on the option that was already selected when the
   *  gesture began (a double click that first selects an option doesn't
   *  count). */
  onReselect?: (v: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  const { rootRef, sizerRef, density, needs } = useFittedDensity<SegmentDensity>(
    fitDensity,
    'full',
    options.length,
  );
  // The full row's natural width. A hugging row (not `fullWidth`) holds it as
  // its width (capped by `max-w-full`), so the room it reads never depends on
  // the density it picked.
  const fullNeed = needs[0];
  const reselect = useReselect(value, onReselect);

  const tight = density === 'tight' || density === 'truncated';
  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('relative gap-0.5', fullWidth ? 'flex w-full' : 'inline-flex max-w-full')}
      style={fullWidth || fullNeed == null ? undefined : { width: fullNeed }}
    >
      {options.map((opt) => {
        const tip = segmentTip(opt, density === 'full');
        const segment = (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={opt.value === value}
            aria-disabled={opt.disabled || undefined}
            onClick={opt.disabled ? undefined : () => onChange(opt.value)}
            {...reselect(opt.value, opt.disabled)}
            className={cn(
              pillVariants({ size, fullWidth, tight, selected: opt.value === value }),
              opt.disabled && 'opacity-40 hover:text-ink-2',
            )}
          >
            <SegmentBody opt={opt} density={density} />
          </button>
        );
        // Wrapped whenever a tip can appear, so a density change never
        // remounts (and unfocuses) the button.
        return opt.title || opt.count != null ? (
          <Tooltip key={String(opt.value)} content={tip}>
            {segment}
          </Tooltip>
        ) : (
          segment
        );
      })}
      <div
        ref={sizerRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        {measured.map((d) => (
          <div key={d} className="flex w-max gap-0.5">
            {options.map((opt) => (
              <span
                key={String(opt.value)}
                className={pillVariants({ size, tight: d === 'tight' })}
              >
                <SegmentBody opt={opt} density={d} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
