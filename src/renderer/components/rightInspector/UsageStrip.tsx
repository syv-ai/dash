import React from 'react';
import type { RateLimits, ContextUsage } from '../../../shared/types';
import { formatResetTime, formatTokens } from '../../utils/format';
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

interface Detail {
  /** Shown first; dropped first when narrow (e.g. "reset in "). */
  prefix?: string;
  /** Shown together with prefix; dropped last when very narrow. */
  value: string;
}

function Row({ label, pct, detail }: { label: string; pct: number; detail?: Detail }) {
  const tier = usageTier(pct);
  const width = Math.min(100, Math.max(0, pct));
  const fullTitle = detail
    ? `${Math.round(pct)}% · ${detail.prefix ?? ''}${detail.value}`
    : `${Math.round(pct)}%`;
  return (
    <div className="grid grid-rows-[auto_3px] gap-[5px]">
      <div className="flex items-baseline justify-between gap-x-2 min-w-0">
        <span
          className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-muted-foreground/70 font-medium truncate min-w-0"
          title={label}
        >
          {label}
        </span>
        <span
          className="font-mono text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0"
          title={fullTitle}
        >
          <span className="text-foreground font-semibold">{Math.round(pct)}%</span>
          {detail ? (
            <span className="usage-detail">
              {' · '}
              {detail.prefix ? <span className="usage-detail-prefix">{detail.prefix}</span> : null}
              {detail.value}
            </span>
          ) : null}
        </span>
      </div>
      <div className="h-[3px] rounded-sm bg-foreground/5 overflow-hidden relative">
        <div
          className={`absolute inset-y-0 left-0 rounded-sm transition-[width] duration-600 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${TIER_FILL[tier]}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function resetDetail(epochSeconds?: number): Detail | undefined {
  if (!epochSeconds) return undefined;
  const t = formatResetTime(epochSeconds);
  if (!t) return undefined;
  if (t.startsWith('in ')) return { prefix: 'reset in ', value: t.slice(3) };
  return { prefix: 'reset ', value: t };
}

export function UsageStrip({ rateLimits, contextUsage }: UsageStripProps) {
  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;
  if (!rateLimits.fiveHour && !rateLimits.sevenDay && !ctx) return null;
  const hasRowAbove = !!(rateLimits.fiveHour || rateLimits.sevenDay);

  return (
    <div className="usage-strip glass-hairline-b px-[18px] pt-[22px] pb-[20px] flex flex-col">
      {rateLimits.fiveHour && (
        <Row
          label="5-hour limit"
          pct={rateLimits.fiveHour.usedPercentage}
          detail={resetDetail(rateLimits.fiveHour.resetsAt)}
        />
      )}
      {rateLimits.sevenDay && (
        <div className={rateLimits.fiveHour ? 'mt-[14px]' : ''}>
          <Row
            label="7-day limit"
            pct={rateLimits.sevenDay.usedPercentage}
            detail={resetDetail(rateLimits.sevenDay.resetsAt)}
          />
        </div>
      )}
      {/* Session row appears once context tokens are reported (after the first
          message). Wrapper is always mounted so the grid-template-rows transition
          fires; top spacing sits inside overflow:hidden so it collapses with the row. */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{
          gridTemplateRows: ctx ? '1fr' : '0fr',
          opacity: ctx ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          {ctx && (
            <div className={hasRowAbove ? 'pt-[14px]' : ''}>
              <Row
                label="Session"
                pct={ctx.percentage}
                detail={{ value: `${formatTokens(ctx.used)} / ${formatTokens(ctx.total)}` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
