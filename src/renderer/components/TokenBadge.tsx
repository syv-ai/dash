import React from 'react';
import { formatTokens, formatCost } from '../utils/format';
import { Tooltip } from './ui/Tooltip';

interface TokenBadgeProps {
  totalTokens: number;
  totalCostUsd: number;
  size?: 'sm' | 'md';
}

export function TokenBadge({ totalTokens, totalCostUsd, size = 'md' }: TokenBadgeProps) {
  if (totalTokens === 0) return null;
  const sizeCls =
    size === 'sm' ? 'gap-1 px-1.5 py-0.5 text-[10px]' : 'gap-1.5 px-2 py-[3px] text-[11px]';
  return (
    <Tooltip content={`${totalTokens.toLocaleString()} tokens`}>
      <span
        className={`inline-flex items-center rounded bg-foreground/5 text-muted-foreground font-mono tabular-nums ${sizeCls}`}
      >
        <span>{formatTokens(totalTokens)}</span>
        <span className="text-foreground/30">·</span>
        <span>{formatCost(totalCostUsd)}</span>
      </span>
    </Tooltip>
  );
}
