import { GitMerge, GitPullRequest } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { prStatusPill } from './prStatusColors';
import type { PullRequestInfo } from '../../../shared/types';

interface PrBadgeProps {
  prInfo: PullRequestInfo;
  size?: 'sm' | 'md';
}

/**
 * PR pill, color-coded by state (standard GitHub colors): open → green,
 * merged → purple. Closed PRs render nothing. Shared by the task header (md)
 * and the ProjectView task cards (sm).
 */
export function PrBadge({ prInfo, size = 'md' }: PrBadgeProps) {
  if (prInfo.state === 'closed') return null;
  const iconSize = size === 'sm' ? 10 : 11;
  const sizeCls = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-[3px] text-[11px]';
  const colorCls = prStatusPill(prInfo.state);
  return (
    <Tooltip content={`${prInfo.title} (${prInfo.state})`}>
      <a
        href={prInfo.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 rounded-full font-mono transition-colors ${sizeCls} ${colorCls}`}
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
