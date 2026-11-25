import * as React from 'react';
import { cn } from '../../lib/cn';
import { clampPercent } from './Meter';

/** A level's figure type: `LevelText`, and the reading inside a
 *  `ProgressRing` beside it, so the two read the same size as a row trades
 *  one for the other. */
export const LEVEL_FIGURE = 'text-base font-semibold tabular-nums';

/**
 * A level as its reading alone, in the level's colour: the ring-less sibling
 * of `ProgressRing`, for where a ring has no room: the ring's figure type,
 * same meter semantics.
 */
export function LevelText({
  value,
  color,
  'aria-label': ariaLabel,
  children,
  className,
}: {
  /** 0–100; null: no reading. */
  value: number | null;
  /** Any CSS colour (a token, or `usageColor(value)`); none reads in `ink-3`. */
  color?: string;
  'aria-label': string;
  /** The reading, as it should read. */
  children: React.ReactNode;
  /** Layout only. */
  className?: string;
}) {
  return (
    <span
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(clampPercent(value))}
      className={cn(LEVEL_FIGURE, color ? 'text-(--level-color)' : 'text-ink-3', className)}
      style={color ? ({ '--level-color': color } as React.CSSProperties) : undefined}
    >
      {children}
    </span>
  );
}
