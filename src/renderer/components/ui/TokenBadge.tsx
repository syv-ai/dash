import React from 'react';
import { formatTokens, formatTokensPrecise, formatCost } from '../../utils/format';
import { useSettings } from '../../stores/settingsStore';
import { Tooltip } from './Tooltip';
import { Badge } from './Badge';
import { cn } from '../../lib/cn';

interface TokenBadgeProps {
  totalTokens: number;
  totalCostUsd: number;
  size?: 'sm' | 'md';
  /** Two decimals in the unit (`2.21B`) instead of the compact count (`2.2B`). */
  precise?: boolean;
}

export function TokenBadge({
  totalTokens,
  totalCostUsd,
  size = 'md',
  precise = false,
}: TokenBadgeProps) {
  const showCost = useSettings((s) => s.showTaskCost);
  if (totalTokens === 0) return null;
  return (
    // Claude Code's supervisor writes per-session summaries and auto names with
    // a separate model call outside the transcript; Dash counts transcripts
    // only, so those calls are billed but never appear here.
    <Tooltip
      content={{
        title: `${totalTokens.toLocaleString()} tokens`,
        body: "From the session transcripts. Claude Code's session summaries are billed separately and not counted.",
        rows: [{ label: 'Cost', value: formatCost(totalCostUsd) }],
      }}
    >
      <Badge size={size} weight="normal">
        <span className={cn(precise && 'tabular-nums')}>
          {precise ? formatTokensPrecise(totalTokens) : formatTokens(totalTokens)}
        </span>
        {showCost && (
          <>
            <span className="text-ink-3">·</span>
            <span>{formatCost(totalCostUsd)}</span>
          </>
        )}
      </Badge>
    </Tooltip>
  );
}
