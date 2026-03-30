import React from 'react';
import type { RateLimits } from '../../shared/types';
import { formatResetTime } from '../../shared/format';
import { UsageBar } from './ui/UsageBar';

export function RateLimitsWidget({ rateLimits }: { rateLimits: RateLimits }) {
  if (!rateLimits.fiveHour && !rateLimits.sevenDay) return null;

  return (
    <div
      className="px-3 py-2.5 border-b border-border/40 space-y-2 flex-shrink-0"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {rateLimits.fiveHour && (
        <UsageBar
          label="5-hour limit"
          percentage={rateLimits.fiveHour.usedPercentage}
          detail={
            rateLimits.fiveHour.resetsAt
              ? `· reset ${formatResetTime(rateLimits.fiveHour.resetsAt)}`
              : undefined
          }
          height={3}
          labelClassName="text-[10px] text-muted-foreground/70 uppercase tracking-wide"
          detailClassName="text-[10px]"
        />
      )}
      {rateLimits.sevenDay && (
        <UsageBar
          label="7-day limit"
          percentage={rateLimits.sevenDay.usedPercentage}
          detail={
            rateLimits.sevenDay.resetsAt
              ? `· reset ${formatResetTime(rateLimits.sevenDay.resetsAt)}`
              : undefined
          }
          height={3}
          labelClassName="text-[10px] text-muted-foreground/70 uppercase tracking-wide"
          detailClassName="text-[10px]"
        />
      )}
    </div>
  );
}
