import React from 'react';
import { Leaf } from 'lucide-react';
import type { RateLimits, ContextUsage } from '../../shared/types';
import { formatResetTime, formatTokens, formatEnergy, formatCarbon } from '../../shared/format';
import { carbonGramsFromWh, householdComparison, flightComparison } from '../../shared/carbon';
import { UsageBar } from './ui/UsageBar';

export function UsageWidget({
  rateLimits,
  contextUsage,
  sessionEnergyWh,
  gridIntensity,
}: {
  rateLimits: RateLimits;
  contextUsage?: ContextUsage;
  /** Estimated energy (Wh) for the active task's session. Omit to hide the carbon row. */
  sessionEnergyWh?: number;
  gridIntensity?: number;
}) {
  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;
  const carbon = sessionEnergyWh && sessionEnergyWh > 0 ? sessionEnergyWh : null;
  if (!rateLimits.fiveHour && !rateLimits.sevenDay && !ctx && !carbon) return null;

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
      {ctx && (
        <UsageBar
          label="Current session"
          percentage={ctx.percentage}
          detail={`· ${formatTokens(ctx.used)}/${formatTokens(ctx.total)}`}
          height={3}
          labelClassName="text-[10px] text-muted-foreground/70 uppercase tracking-wide"
          detailClassName="text-[10px]"
        />
      )}
      {carbon && (
        <div
          className="flex items-center justify-between text-[10px]"
          title={`Estimated · ${householdComparison(carbon)} · ${flightComparison(
            carbonGramsFromWh(carbon, gridIntensity),
          )}`}
        >
          <span className="flex items-center gap-1 text-muted-foreground/70 uppercase tracking-wide">
            <Leaf size={11} strokeWidth={1.8} className="text-emerald-400" />
            Carbon (est.)
          </span>
          <span className="tabular-nums font-medium text-foreground/60">
            {formatCarbon(carbonGramsFromWh(carbon, gridIntensity))}
            <span className="text-foreground/40 font-normal ml-1.5">· {formatEnergy(carbon)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
