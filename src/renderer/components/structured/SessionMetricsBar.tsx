import React from 'react';
import { Zap, Clock, MessageSquare } from 'lucide-react';
import type { SessionMetrics } from '../../../shared/sessionTypes';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

interface SessionMetricsBarProps {
  metrics: SessionMetrics;
}

export function SessionMetricsBar({ metrics }: SessionMetricsBarProps) {
  if (metrics.messageCount === 0) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-surface-1 border-b border-border text-[10px] text-muted-foreground">
      <div className="flex items-center gap-1">
        <Zap size={10} strokeWidth={2} className="text-muted-foreground/60" />
        <span>{formatTokens(metrics.totalTokens)} tokens</span>
        <span className="text-muted-foreground/40">
          ({formatTokens(metrics.inputTokens)} in / {formatTokens(metrics.outputTokens)} out)
        </span>
      </div>
      {metrics.cacheReadTokens > 0 && (
        <span className="text-muted-foreground/40">
          cache: {formatTokens(metrics.cacheReadTokens)}
        </span>
      )}
      {metrics.durationMs > 0 && (
        <div className="flex items-center gap-1">
          <Clock size={10} strokeWidth={2} className="text-muted-foreground/60" />
          <span>{formatDuration(metrics.durationMs)}</span>
        </div>
      )}
      <div className="flex items-center gap-1">
        <MessageSquare size={10} strokeWidth={2} className="text-muted-foreground/60" />
        <span>{metrics.messageCount} messages</span>
      </div>
    </div>
  );
}
