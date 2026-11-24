import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  MoreHorizontal,
  RefreshCw,
  Repeat,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { PrReview, TaskReviewTarget } from '../../../shared/types';
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
import { SwitchPr } from './SwitchPr';

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
 * The Review view's head: the PR's title (it opens the PR overview tab), why
 * it is shown, its branches, how far it is from its base, its state, reviewers
 * and checks; Refresh, and a menu with "Open on <forge>", "Switch PR…" and,
 * for a picked PR, "Stop reviewing". A refresh that failed says why under the
 * title, until the next one lands.
 */
export function ReviewHeader({
  review,
  source,
  projectId,
  cwd,
  loading,
  error,
  onRefresh,
  onOpenOverview,
  onSwitch,
  onStop,
}: {
  review: PrReview;
  /** Why the task reviews this PR (D3). */
  source: TaskReviewTarget['source'];
  /** Where Switch PR… lists the PRs from. */
  projectId: string;
  cwd: string;
  loading: boolean;
  /** Why the last refresh failed; null after a good one. */
  error: string | null;
  onRefresh: () => void;
  onOpenOverview: () => void;
  /** Review PR `number` instead; resolves false when it couldn't be loaded. */
  onSwitch: (number: number) => Promise<boolean>;
  /** Stop reviewing the picked PR (back to the branch's own, or none). */
  onStop: () => void;
}) {
  const checks = checksSummary(review.checks);
  const [switching, setSwitching] = useState(false);
  // Switch PR… from the menu: the menu's close must not hand focus back to
  // its trigger, which would close the picker as it opens.
  const switchFromMenu = useRef(false);

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
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              if (!switchFromMenu.current) return;
              switchFromMenu.current = false;
              e.preventDefault();
              setSwitching(true);
            }}
          >
            <DropdownMenuItem onSelect={() => void window.electronAPI.openExternal(review.url)}>
              <ExternalLink size={14} strokeWidth={1.8} />
              Open on {providerName(review.provider)}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => (switchFromMenu.current = true)}>
              <Repeat size={14} strokeWidth={1.8} />
              Switch PR…
            </DropdownMenuItem>
            {source === 'stored' && (
              <DropdownMenuItem onSelect={onStop}>
                <X size={14} strokeWidth={1.8} />
                Stop reviewing
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SwitchPr
        open={switching}
        onOpenChange={setSwitching}
        projectId={projectId}
        cwd={cwd}
        selected={review.number}
        onSwitch={onSwitch}
      >
        <p className="type-caption">
          {source === 'own' ? (
            "This branch's pull request"
          ) : (
            <>
              Picked for review ·{' '}
              <TextLink quiet title="Review another PR" onClick={() => setSwitching(true)}>
                Switch PR…
              </TextLink>
            </>
          )}
        </p>
      </SwitchPr>
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
