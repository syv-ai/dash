import React from 'react';
import { formatTokens, formatCost } from '../../utils/format';
import { useSettings } from '../../stores/settingsStore';
import { Tooltip } from './Tooltip';
import { Badge } from './Badge';

interface TokenBadgeProps {
  totalTokens: number;
  totalCostUsd: number;
  size?: 'sm' | 'md';
}

export function TokenBadge({ totalTokens, totalCostUsd, size = 'md' }: TokenBadgeProps) {
  const showCost = useSettings((s) => s.showTaskCost);
  if (totalTokens === 0) return null;
  return (
    // Claude Code's supervisor writes per-session summaries and auto names with
    // a separate model call outside the transcript; Dash counts transcripts
    // only, so those calls are billed but never appear here.
    <Tooltip
      content={`${totalTokens.toLocaleString()} tokens from the session transcripts (Claude Code's session summaries are billed separately and not counted)`}
    >
      <Badge size={size === 'sm' ? 'sm' : 'md'} className="font-normal">
        <span>{formatTokens(totalTokens)}</span>
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
