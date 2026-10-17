import { GitMerge, GitPullRequest } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { ciDot, ciLabel, prStatusPill, prStatusText } from './prStatusColors';
import type { PullRequestInfo } from '../../../shared/types';

interface PrBadgeProps {
  /** The PRs worth showing, newest first (see relevantPrs); nothing renders when empty. */
  prs: PullRequestInfo[];
  size?: 'sm' | 'md';
  /** `pill` (default) shows "PR #n"; `icon` is just the state icon as a
   *  compact link button, for dense rows like the sidebar task list. */
  variant?: 'pill' | 'icon';
}

function describe(pr: PullRequestInfo): string {
  return `PR #${pr.number}: ${pr.title} (${pr.state}${pr.ci ? `, ${ciLabel(pr.ci)}` : ''})`;
}

function CiDot({ pr, size = 6 }: { pr: PullRequestInfo; size?: number }) {
  if (!pr.ci) return null;
  return (
    <span
      aria-label={ciLabel(pr.ci)}
      className={`inline-block rounded-full shrink-0 ${ciDot(pr.ci)}`}
      style={{ width: size, height: size }}
    />
  );
}

/** "+N" for a branch with several PRs, opening a list of all of them. */
function MorePrs({ prs }: { prs: PullRequestInfo[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`All ${prs.length} PRs on this branch`}
          className="rounded-full px-1 text-[10px] font-mono text-muted-fade-70 hover:text-foreground transition-colors"
        >
          +{prs.length - 1}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-1 min-w-[220px] max-w-[360px]"
        onClick={(e) => e.stopPropagation()}
      >
        {prs.map((pr) => {
          const Icon = pr.state === 'merged' ? GitMerge : GitPullRequest;
          return (
            <a
              key={pr.number}
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-accent transition-colors"
            >
              <Icon size={14} strokeWidth={1.8} className={`shrink-0 ${prStatusText(pr.state)}`} />
              <span className="font-mono text-muted-fade-70 shrink-0">#{pr.number}</span>
              <span className="truncate flex-1 min-w-0">{pr.title}</span>
              <CiDot pr={pr} />
            </a>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The newest relevant PR as a link, color-coded by state (standard GitHub
 * colors): open → green, merged → purple, closed → red, with a dot for its
 * checks; "+N" lists the rest. The pill variants hide a closed PR; the icon
 * variant always renders. Shared by the task header (md pill), the ProjectView
 * task cards (sm pill) and the sidebar rows (icon).
 */
export function PrBadge({ prs, size = 'md', variant = 'pill' }: PrBadgeProps) {
  const pr = prs[0];
  if (!pr) return null;
  const colorCls = prStatusPill(pr.state);
  const Icon = pr.state === 'merged' ? GitMerge : GitPullRequest;
  const tooltip = prs.length > 1 ? `${describe(pr)}, and ${prs.length - 1} more` : describe(pr);

  // The sidebar icon always shows — a closed PR (red) is still the link the
  // user wants — while the larger pills keep hiding closed ones.
  if (variant === 'icon') {
    return (
      <Tooltip content={tooltip}>
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open PR #${pr.number}`}
          className={`relative inline-flex items-center justify-center rounded-md w-[18px] h-[18px] shrink-0 transition-colors ${colorCls}`}
        >
          <Icon size={11} strokeWidth={2} />
          {pr.ci && (
            <span className="absolute -top-0.5 -right-0.5">
              <CiDot pr={pr} size={5} />
            </span>
          )}
        </a>
      </Tooltip>
    );
  }

  if (pr.state === 'closed') return null;
  const iconSize = size === 'sm' ? 10 : 11;
  const sizeCls = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-[3px] text-[11px]';
  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip content={tooltip}>
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center gap-1 rounded-full font-mono transition-colors ${sizeCls} ${colorCls}`}
        >
          <Icon size={iconSize} strokeWidth={2} />
          PR #{pr.number}
          <CiDot pr={pr} />
        </a>
      </Tooltip>
      {prs.length > 1 && <MorePrs prs={prs} />}
    </span>
  );
}
