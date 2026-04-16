import React from 'react';

export function usageColor(percentage: number): string {
  return percentage >= 80 ? 'bg-red-400' : percentage >= 60 ? 'bg-amber-400' : 'bg-emerald-400';
}

export function usageTextColor(percentage: number): string {
  return percentage >= 80
    ? 'text-red-400'
    : percentage >= 60
      ? 'text-amber-400'
      : 'text-foreground/50';
}

interface UsageBarProps {
  label?: string;
  percentage: number;
  detail?: string;
  height?: number;
  width?: string;
  labelClassName?: string;
  detailClassName?: string;
}

/** Compact bar-only variant for inline use (no label row). */
export function UsageBarInline({
  percentage,
  height = 4,
  width = '48px',
  className = '',
  title,
}: {
  percentage: number;
  height?: number;
  width?: string;
  className?: string;
  title?: string;
}) {
  const pct = Math.min(percentage, 100);
  return (
    <div
      className={`rounded-full bg-border/40 overflow-hidden ${className}`}
      style={{ width, height: `${height}px` }}
      title={title}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${usageColor(pct)}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function UsageBar({
  label,
  percentage,
  detail,
  height = 6,
  width,
  labelClassName = 'text-[12px] text-foreground/80',
  detailClassName = 'text-[11px]',
}: UsageBarProps) {
  const pct = Math.min(percentage, 100);
  const color = usageColor(pct);
  const textColor = usageTextColor(pct);

  return (
    <div className="space-y-1.5" style={width ? { width } : undefined}>
      {(label || detail !== undefined) && (
        <div className="flex items-center justify-between">
          {label && <span className={labelClassName}>{label}</span>}
          <span className={`${detailClassName} tabular-nums font-medium ${textColor}`}>
            {Math.round(pct)}%
            {detail && <span className="text-foreground/40 font-normal ml-1.5">{detail}</span>}
          </span>
        </div>
      )}
      <div className="rounded-full bg-border/40 overflow-hidden" style={{ height: `${height}px` }}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
