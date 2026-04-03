import React from 'react';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface TokenBadgeProps {
  tokens: number;
  label?: string;
}

export function TokenBadge({ tokens, label }: TokenBadgeProps) {
  if (tokens === 0) return null;

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-1 text-muted-foreground text-[10px] font-mono leading-none">
      {label && <span className="text-muted-foreground/60">{label}</span>}
      {formatTokens(tokens)}
    </span>
  );
}
