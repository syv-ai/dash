import { ExternalLink, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import type { PrReview, PrReviewer, PrState } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { DetailItem, DetailList } from '../ui/DetailList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { IconButton } from '../ui/IconButton';
import { TextLink } from '../ui/TextLink';
import { providerName } from '../diffEditor/prReview/PrThreadCard';
import { checkCounts } from './outline';

const STATE_LABELS: Record<PrState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

const REVIEWER_LABELS: Record<PrReviewer['state'], string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
  pending: 'pending',
  approved_with_suggestions: 'approved with suggestions',
  waiting: 'waiting for author',
  rejected: 'rejected',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 passing · 1 failing", the states with checks in them; null with none. */
function checksLine(review: PrReview): string | null {
  const n = checkCounts(review.checks);
  const parts = (['passing', 'failing', 'pending'] as const)
    .filter((k) => n[k] > 0)
    .map((k) => `${n[k]} ${k}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The Review view's head: the PR's title (it opens the PR overview tab), its
 * branches, how far it is from its base, its state, reviewers and checks;
 * Refresh, and a menu with "Open on <forge>" and "Stop reviewing".
 */
export function ReviewHeader({
  review,
  loading,
  onRefresh,
  onOpenOverview,
  onStop,
}: {
  review: PrReview;
  loading: boolean;
  onRefresh: () => void;
  onOpenOverview: () => void;
  /** Stop reviewing the PR picked for the task; absent when it is the task's own. */
  onStop?: () => void;
}) {
  const checks = checksLine(review);
  const reviewers = review.reviewers
    .map((r) => `${r.name} (${REVIEWER_LABELS[r.state]})`)
    .join(', ');
  const distance = [
    plural(review.commits, 'commit'),
    review.behindBase !== null && `${review.behindBase} behind base`,
  ]
    .filter(Boolean)
    .join(' · ');

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
      <DetailList>
        <DetailItem label="Branches" title={`${review.baseRef} ← ${review.headRef}`}>
          {review.baseRef} ← {review.headRef}
        </DetailItem>
        <DetailItem label="Commits">
          <span className="tabular-nums">{distance}</span>
        </DetailItem>
        <DetailItem label="State">
          {STATE_LABELS[review.state]}
          {review.author && <span className="text-ink-3"> · by {review.author}</span>}
        </DetailItem>
        {reviewers && (
          <DetailItem label="Reviewers" title={reviewers}>
            {reviewers}
          </DetailItem>
        )}
        {checks && (
          <DetailItem label="Checks" title={checks}>
            <span className="tabular-nums">{checks}</span>
          </DetailItem>
        )}
      </DetailList>
    </section>
  );
}
