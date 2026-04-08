import React from 'react';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

interface DurationBadgeProps {
  ms: number;
}

export function DurationBadge({ ms }: DurationBadgeProps) {
  if (ms <= 0) return null;

  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-1 text-muted-foreground text-[10px] font-mono leading-none">
      {formatDuration(ms)}
    </span>
  );
}
