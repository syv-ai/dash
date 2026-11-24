import * as React from 'react';
import { cn } from '../../lib/cn';
import { clampPercent } from './Meter';

interface ProgressRingProps {
  /** 0–100; values outside are clamped. Null draws the track alone (no reading). */
  value: number | null;
  /** The drawn diameter in px. A variant `size-*` class (`@max-…:size-8`) can
   *  override it; the stroke scales along. */
  size?: number;
  /** The ring's thickness in px at `size`. */
  stroke?: number;
  /** The arc's colour, any CSS colour (a token, or `usageColor(value)`). */
  color?: string;
  'aria-label': string;
  /** `aria-valuetext`, when the rounded percent alone reads wrong. */
  valueText?: string;
  /** Centred over the ring: the value, as it should read. */
  children?: React.ReactNode;
  /** Layout only (size overrides, margins). */
  className?: string;
}

/**
 * A level as a ring: a hover-tint track and a round-capped arc running
 * clockwise from 12 o'clock, with its reading centred inside. The circular
 * sibling of `Meter`.
 */
export function ProgressRing({
  value,
  size = 40,
  stroke = 3.5,
  color = 'hsl(var(--ink-2))',
  'aria-label': ariaLabel,
  valueText,
  children,
  className,
}: ProgressRingProps) {
  const pct = value === null ? 0 : clampPercent(value);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const centre = size / 2;
  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(pct)}
      aria-valuetext={valueText}
      className={cn('relative grid size-(--ring-size) shrink-0 place-items-center', className)}
      style={{ '--ring-size': `${size}px`, '--ring-color': color } as React.CSSProperties}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 size-full -rotate-90">
        <circle
          cx={centre}
          cy={centre}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-hover"
        />
        {/* A round cap would still draw a dot at 0. */}
        {pct > 0 && (
          <circle
            cx={centre}
            cy={centre}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
            className="stroke-(--ring-color) transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
          />
        )}
      </svg>
      {children !== undefined && <span className="relative">{children}</span>}
    </div>
  );
}
