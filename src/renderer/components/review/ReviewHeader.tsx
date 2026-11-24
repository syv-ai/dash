import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  MoreHorizontal,
  RefreshCw,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { PrReview } from '../../../shared/types';
import { cn } from '../../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { IconButton } from '../ui/IconButton';
import { TextLink } from '../ui/TextLink';
import { checksSummary } from './outline';
import { distanceLine, providerName, REVIEWER_LABELS, STATE_LABELS } from './labels';

/** One fact about the PR: an icon naming what it is, then the value, which
 *  wraps rather than truncates (the list column can be narrow). */
function Fact({
  icon: Icon,
  name,
  children,
}: {
  icon: LucideIcon;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2" title={name}>
      <span className="flex h-4 shrink-0 items-center text-ink-3">
        <Icon size={14} strokeWidth={1.8} aria-label={name} />
      </span>
      <div className="type-body min-w-0 flex-1 wrap-break-word">{children}</div>
    </div>
  );
}

/**
 * The Review view's head: the PR's title (it opens the PR overview tab), its
 * branches, how far it is from its base, its state, reviewers and checks;
 * Refresh, and a menu with "Open on <forge>" and "Stop reviewing". A refresh
 * that failed says why under the title, until the next one lands.
 */
export function ReviewHeader({
  review,
  loading,
  error,
  onRefresh,
  onOpenOverview,
  onStop,
}: {
  review: PrReview;
  loading: boolean;
  /** Why the last refresh failed; null after a good one. */
  error: string | null;
  onRefresh: () => void;
  onOpenOverview: () => void;
  /** Stop reviewing the PR picked for the task; absent when it is the task's own. */
  onStop?: () => void;
}) {
  const checks = checksSummary(review.checks);

  return (
    <section className="grid gap-2 px-2.5 pt-2 pb-1">
      <div className="flex items-start gap-1">
        <h2 className="type-heading min-w-0 flex-1 pt-0.5 wrap-break-word">
          <TextLink quiet title="Open the PR overview" onClick={onOpenOverview}>
            PR #{review.number} {review.title}
          </TextLink>
        </h2>
        <IconButton size="sm" title="Refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} strokeWidth={1.8} className={cn(loading && 'animate-spin')} />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" title="More">
              <MoreHorizontal size={14} strokeWidth={1.8} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void window.electronAPI.openExternal(review.url)}>
              <ExternalLink size={14} strokeWidth={1.8} />
              Open on {providerName(review.provider)}
            </DropdownMenuItem>
            {onStop && (
              <DropdownMenuItem onSelect={onStop}>
                <X size={14} strokeWidth={1.8} />
                Stop reviewing
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <p className="type-caption wrap-break-word" role="status">
          Could not refresh: {error}
        </p>
      )}
      <div className="grid gap-1.5">
        <Fact icon={GitPullRequest} name="State">
          {STATE_LABELS[review.state]}
          {review.author && <span className="type-caption"> · by {review.author}</span>}
        </Fact>
        <Fact icon={GitBranch} name="Branches">
          <span className="wrap-anywhere">
            {review.baseRef} ← {review.headRef}
          </span>
        </Fact>
        <Fact icon={GitCommitHorizontal} name="Commits">
          <span className="tabular-nums">{distanceLine(review)}</span>
        </Fact>
        {review.reviewers.length > 0 && (
          <Fact icon={Users} name="Reviewers">
            {review.reviewers.map((r, i) => (
              <span key={r.name}>
                {i > 0 && ', '}
                {r.name} <span className="type-caption">{REVIEWER_LABELS[r.state]}</span>
              </span>
            ))}
          </Fact>
        )}
        {checks && (
          <Fact icon={ListChecks} name="Checks">
            <span className="tabular-nums">{checks}</span>
          </Fact>
        )}
      </div>
    </section>
  );
}
