import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export type MeterTone = 'neutral' | 'warn' | 'needs' | 'fail' | 'work' | 'done';

/** 0–100, clamped; NaN reads as 0. */
export function clampPercent(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value));
}

/**
 * The tone for a usage meter, where more is worse: neutral below 60%, warn
 * (amber) from 60%, fail (red) from 80%. Progress meters stay neutral.
 */
export function usageTone(percent: number): MeterTone {
  const pct = clampPercent(percent);
  return pct >= 80 ? 'fail' : pct >= 60 ? 'warn' : 'neutral';
}

const fillVariants = cva('h-full rounded-full transition-[width] duration-500 ease-out', {
  variants: {
    tone: {
      neutral: 'bg-ink-3',
      warn: 'bg-warn',
      needs: 'bg-state-needs',
      fail: 'bg-state-fail',
      work: 'bg-state-work',
      done: 'bg-state-done',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

/** A tone's text colour, for the percent in the label row. */
const meterToneText: Record<MeterTone, string> = {
  neutral: 'text-ink',
  warn: 'text-warn',
  needs: 'text-state-needs',
  fail: 'text-state-fail',
  work: 'text-state-work',
  done: 'text-state-done',
};

interface MeterProps {
  /** 0–100; values outside are clamped. */
  value: number;
  /** Fill colour: ink-3, or a state. Use `usageTone(value)` for usage meters. */
  tone?: MeterTone;
  /** md = the 4px track, sm = a 2px hairline for dense rows. */
  size?: 'sm' | 'md';
  /** With a label, a row above the track shows it and the rounded percent. */
  label?: React.ReactNode;
  /** Quiet text after the percent ("resets in 2h"). */
  detail?: React.ReactNode;
  /** `progressbar` for work underway (a download); `meter` for a level. */
  role?: 'meter' | 'progressbar';
  title?: string;
  'aria-label'?: string;
  /** Layout only (width, margins). */
  className?: string;
}

/**
 * A level or progress bar: a 4px hover-tint track with a rounded fill. It
 * serves usage (tinted by `usageTone`) and progress (neutral) alike.
 */
export function Meter({
  value,
  tone = 'neutral',
  size = 'md',
  label,
  detail,
  role = 'meter',
  title,
  'aria-label': ariaLabel,
  className,
}: MeterProps) {
  const pct = clampPercent(value);
  const track = (
    <div
      role={role}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      title={title}
      className={cn('overflow-hidden rounded-full bg-hover', size === 'sm' ? 'h-0.5' : 'h-1')}
    >
      <div className={fillVariants({ tone })} style={{ width: `${pct}%` }} />
    </div>
  );
  if (label === undefined) return <div className={className}>{track}</div>;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-ink-2">{label}</span>
        <span className="shrink-0 tabular-nums">
          <span className={cn('font-medium', meterToneText[tone])}>{Math.round(pct)}%</span>
          {detail && <span className="ml-1.5 text-ink-3">{detail}</span>}
        </span>
      </div>
      {track}
    </div>
  );
}
