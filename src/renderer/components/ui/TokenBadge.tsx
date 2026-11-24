import React from 'react';
import { formatTokens, formatCost } from '../../utils/format';
import { useSettings } from '../../stores/settingsStore';
import { Tooltip } from './Tooltip';

interface TokenBadgeProps {
  totalTokens: number;
  totalCostUsd: number;
  size?: 'sm' | 'md';
}

export function TokenBadge({ totalTokens, totalCostUsd, size = 'md' }: TokenBadgeProps) {
  const showCost = useSettings((s) => s.showTaskCost);
  if (totalTokens === 0) return null;
  const sizeCls = size === 'sm' ? 'gap-1 px-1.5 py-0.5 text-xs' : 'gap-1.5 px-2 py-[3px] text-xs';
  return (
    // Claude Code's supervisor writes per-session summaries and auto names with
    // a separate model call outside the transcript; Dash counts transcripts
    // only, so those calls are billed but never appear here.
    <Tooltip
      content={`${totalTokens.toLocaleString()} tokens from the session transcripts (Claude Code's session summaries are billed separately and not counted)`}
    >
      <span
        className={`inline-flex items-center rounded-full bg-foreground/5 text-muted-foreground font-mono tabular-nums ${sizeCls}`}
      >
        <span>{formatTokens(totalTokens)}</span>
        {showCost && (
          <>
            <span className="text-fg-fade-30">·</span>
            <span>{formatCost(totalCostUsd)}</span>
          </>
        )}
      </span>
    </Tooltip>
  );
}
