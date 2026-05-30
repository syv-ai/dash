import React from 'react';
import type { RateLimits, ContextUsage } from '../../../shared/types';
import { formatResetTime, formatTokens } from '../../../shared/format';
import { usageTier, type UsageTier } from './usageTier';

interface UsageStripProps {
  rateLimits: RateLimits;
  contextUsage?: ContextUsage;
}

const TIER_FILL: Record<UsageTier, string> = {
  good: 'bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.4)]',
  warn: 'bg-[hsl(var(--warn))] shadow-[0_0_6px_hsl(var(--warn)/0.4)]',
  danger: 'bg-destructive shadow-[0_0_8px_hsl(var(--destructive)/0.5)]',
};

function Row({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  const tier = usageTier(pct);
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="grid grid-rows-[auto_3px] gap-[5px]">
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span
          className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-muted-foreground/70 font-medium truncate min-w-0"
          title={label}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
          <span className="text-foreground font-semibold">{Math.round(pct)}%</span>
          {detail ? <> · {detail}</> : null}
        </span>
      </div>
      <div className="h-[3px] rounded-sm bg-foreground/5 overflow-hidden relative">
        <div
          className={`absolute inset-y-0 left-0 rounded-sm transition-[width] duration-[600ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${TIER_FILL[tier]}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function UsageStrip({ rateLimits, contextUsage }: UsageStripProps) {
  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;
  if (!rateLimits.fiveHour && !rateLimits.sevenDay && !ctx) return null;

  return (
    <div className="px-[18px] pt-[22px] pb-[20px] border-b border-border/60 flex flex-col gap-[14px]">
      {rateLimits.fiveHour && (
        <Row
          label="5-hour limit"
          pct={rateLimits.fiveHour.usedPercentage}
          detail={
            rateLimits.fiveHour.resetsAt
              ? `reset ${formatResetTime(rateLimits.fiveHour.resetsAt)}`
              : undefined
          }
        />
      )}
      {rateLimits.sevenDay && (
        <Row
          label="7-day limit"
          pct={rateLimits.sevenDay.usedPercentage}
          detail={
            rateLimits.sevenDay.resetsAt
              ? `reset ${formatResetTime(rateLimits.sevenDay.resetsAt)}`
              : undefined
          }
        />
      )}
      {ctx && (
        <Row
          label="Current session"
          pct={ctx.percentage}
          detail={`${formatTokens(ctx.used)} / ${formatTokens(ctx.total)}`}
        />
      )}
    </div>
  );
}
