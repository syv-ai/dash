import { GitMerge, GitPullRequest } from 'lucide-react';
import { Tooltip } from './Tooltip';
import type { PullRequestInfo } from '../../../shared/types';

interface PrBadgeProps {
  prInfo: PullRequestInfo;
  size?: 'sm' | 'md';
}

/**
 * PR pill, color-coded by state: merged → primary, open → git-added green.
 * Closed PRs render nothing. Shared by the task header (md) and the
 * ProjectView task cards (sm).
 */
export function PrBadge({ prInfo, size = 'md' }: PrBadgeProps) {
  if (prInfo.state === 'closed') return null;
  const iconSize = size === 'sm' ? 10 : 11;
  const sizeCls = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-[3px] text-[11px]';
  const colorCls =
    prInfo.state === 'merged'
      ? 'bg-primary/10 text-primary hover:bg-primary/20'
      : 'bg-[hsl(var(--git-added))]/10 text-[hsl(var(--git-added))] hover:bg-[hsl(var(--git-added))]/20';
  return (
    <Tooltip content={`${prInfo.title} (${prInfo.state})`}>
      <a
        href={prInfo.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 rounded font-mono transition-colors ${sizeCls} ${colorCls}`}
      >
        {prInfo.state === 'merged' ? (
          <GitMerge size={iconSize} strokeWidth={2} />
        ) : (
          <GitPullRequest size={iconSize} strokeWidth={2} />
        )}
        PR #{prInfo.number}
      </a>
    </Tooltip>
  );
}
