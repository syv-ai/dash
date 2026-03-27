import React from 'react';
import type { RateLimits } from '../../shared/types';

function formatResetTime(epochSeconds: number): string {
  if (!epochSeconds) return '';
  const diffMs = epochSeconds * 1000 - Date.now();
  if (diffMs <= 0) return 'now';
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `reset in ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `reset in ${diffH}h ${diffMin % 60}m`;
  const diffD = Math.floor(diffH / 24);
  const remH = diffH % 24;
  return remH > 0 ? `reset in ${diffD}d ${remH}h` : `reset in ${diffD}d`;
}

function RateBar({
  label,
  percentage,
  resetsAt,
}: {
  label: string;
  percentage: number;
  resetsAt?: number;
}) {
  const pct = Math.min(percentage, 100);
  const color = pct >= 80 ? 'bg-red-400' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-400';
  const textColor =
    pct >= 80 ? 'text-red-400' : pct >= 60 ? 'text-amber-400' : 'text-foreground/50';
  const resetLabel = resetsAt ? formatResetTime(resetsAt) : '';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">
          {label}
        </span>
        <span className={`text-[10px] tabular-nums font-medium ${textColor}`}>
          {Math.round(pct)}%
          {resetLabel && (
            <span className="text-foreground/35 font-normal ml-1">· {resetLabel}</span>
          )}
        </span>
      </div>
      <div className="h-[3px] rounded-full bg-border/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function RateLimitsWidget({ rateLimits }: { rateLimits: RateLimits }) {
  if (!rateLimits.fiveHour && !rateLimits.sevenDay) return null;

  return (
    <div
      className="px-3 py-2.5 border-b border-border/40 space-y-2 flex-shrink-0"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {rateLimits.fiveHour && (
        <RateBar
          label="5-hour limit"
          percentage={rateLimits.fiveHour.usedPercentage}
          resetsAt={rateLimits.fiveHour.resetsAt}
        />
      )}
      {rateLimits.sevenDay && (
        <RateBar
          label="7-day limit"
          percentage={rateLimits.sevenDay.usedPercentage}
          resetsAt={rateLimits.sevenDay.resetsAt}
        />
      )}
    </div>
  );
}
