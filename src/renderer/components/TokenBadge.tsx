import React from 'react';
import { formatTokens, formatCost } from '../utils/formatTokens';
import { Tooltip } from './ui/Tooltip';

interface TokenBadgeProps {
  totalTokens: number;
  totalCostUsd: number;
}

export function TokenBadge({ totalTokens, totalCostUsd }: TokenBadgeProps) {
  if (totalTokens === 0) return null;
  return (
    <Tooltip content={`${totalTokens.toLocaleString()} tokens`}>
      <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded bg-foreground/5 text-muted-foreground font-mono text-[11px] tabular-nums">
        <span>{formatTokens(totalTokens)}</span>
        <span className="text-foreground/30">·</span>
        <span>{formatCost(totalCostUsd)}</span>
      </span>
    </Tooltip>
  );
}
