import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { CountBadge } from './CountBadge';
import { focusRing } from './styles';
import { Tooltip } from './Tooltip';

const segmentVariants = cva(
  cn(
    'flex min-w-0 items-center justify-center rounded-md font-medium text-ink-2 transition-colors duration-150 hover:text-ink aria-checked:bg-select aria-checked:text-ink [&_svg]:shrink-0',
    focusRing,
  ),
  {
    variants: {
      size: { sm: 'h-6 text-sm', md: 'h-7 text-sm' },
      fullWidth: { true: 'flex-1', false: '' },
      tight: { true: 'gap-1 px-1.5', false: 'gap-1.5 px-2.5' },
    },
    defaultVariants: { tight: false },
  },
);

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
  // Half a pixel of slack: layout widths are fractional, client widths not.
  return measured.find((_, i) => (needs[i] ?? Infinity) <= available + 0.5) ?? 'truncated';
}

/** A segment's tooltip: its `title`, plus the count once the badge is gone. */
export function segmentTip(
  opt: { label: string; count?: number; title?: string },
  countShown: boolean,
): string | undefined {
  if (countShown || opt.count == null) return opt.title;
  return opt.title ? `${opt.title} (${opt.count})` : `${opt.label}: ${opt.count}`;
}

type Option<T> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  count?: number;
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
  fullWidth = true,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  options: Array<Option<T>>;
  onChange: (v: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sizerRef = React.useRef<HTMLDivElement>(null);
  const [density, setDensity] = React.useState<SegmentDensity>('full');
  // The full row's natural width. A hugging row (not `fullWidth`) holds it as
  // its width (capped by `max-w-full`), so the room it reads never depends on
  // the density it picked.
  const [fullNeed, setFullNeed] = React.useState<number>();

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const sizer = sizerRef.current;
    if (!root || !sizer) return;
    const fit = () => {
      const needs = Array.from(sizer.children, (row) => row.getBoundingClientRect().width);
      setFullNeed(Math.ceil(needs[0] ?? 0));
      setDensity(fitDensity(root.clientWidth, needs));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    for (const row of sizer.children) observer.observe(row);
    return () => observer.disconnect();
  }, [options.length]);

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
            className={cn(
              segmentVariants({ size, fullWidth, tight }),
              opt.disabled && 'opacity-40 hover:text-ink-2',
            )}
          >
            <SegmentBody opt={opt} density={density} />
          </button>
        );
        // Wrapped whenever a tip can appear, so a density change never
        // remounts (and unfocuses) the button.
        return opt.title || opt.count != null ? (
          <Tooltip key={String(opt.value)} content={tip} open={tip ? undefined : false}>
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
                className={segmentVariants({ size, fullWidth: false, tight: d === 'tight' })}
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
