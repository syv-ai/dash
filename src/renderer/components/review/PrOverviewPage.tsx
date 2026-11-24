import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  ExternalLink,
  GitPullRequest,
} from 'lucide-react';
import { formatTimeAgo } from '../../../shared/relativeTime';
import type { PrCheck, PrProvider, PrReview, PrReviewComment } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DetailItem, DetailList, DetailSection } from '../ui/DetailList';
import { EmptyState } from '../ui/EmptyState';
import { ListRow } from '../ui/ListRow';
import { Markdown } from '../ui/Markdown';
import { ciPulse } from '../ui/prStatusColors';
import { IconButton } from '../ui/IconButton';
import { CHECK_LABELS, distanceLine, providerName, REVIEWER_LABELS, STATE_LABELS } from './labels';

/**
 * A PR's overview, the sheet of its `dash:pr/*` editor tab: title, state,
 * branches and distance from base, reviewers, assignees, checks, the full
 * description and the conversation (read-only, oldest first). Reads the
 * PR's loaded review, and loads it when the tab opens before the Review
 * view has (a restored tab).
 */
export function PrOverviewPage({
  provider,
  number,
  projectId,
  cwd,
  onShowFiles,
}: {
  provider: PrProvider;
  number: number;
  projectId: string | null;
  cwd: string;
  /** Back to the PR's files: the Review view. Absent where there is none. */
  onShowFiles?: () => void;
}) {
  const review = usePrReviews((s) => s.byPr[prKey(provider, number)] ?? null);
  const [error, setError] = useState<string | null>(null);
  const missing = review === null;
  useEffect(() => {
    if (!missing || !projectId) return;
    let live = true;
    void usePrReviews
      .getState()
      .load(projectId, cwd, number)
      .then((r) => {
        if (live && !r.ok) setError(r.error);
      });
    return () => {
      live = false;
    };
  }, [missing, projectId, cwd, number]);

  if (!review) {
    return error ? (
      <EmptyState
        icon={<GitPullRequest size={14} strokeWidth={1.8} />}
        title={`Could not load PR #${number}`}
        description={error}
      />
    ) : (
      <EmptyState icon={<GitPullRequest size={14} strokeWidth={1.8} />} title="Loading…" />
    );
  }
  return (
    <div className="scrollbar-gutter-stable scrollbar-thin-hover h-full min-h-0 overflow-y-auto">
      <article className="mx-auto grid max-w-3xl gap-1 px-4 py-5">
        <Header review={review} onShowFiles={onShowFiles} />
        <Reviewers review={review} />
        <Checks checks={review.checks} />
        <DetailSection title="Description">
          {review.body.trim() ? (
            <div className="type-body px-2.5">
              <Markdown text={review.body} />
            </div>
          ) : (
            <p className="type-caption px-2.5">No description.</p>
          )}
        </DetailSection>
        <Conversation comments={review.conversation} forge={providerName(review.provider)} />
      </article>
    </div>
  );
}

function Header({ review, onShowFiles }: { review: PrReview; onShowFiles?: () => void }) {
  return (
    <header className="grid gap-3 px-2.5">
      <div className="flex items-center gap-2">
        <span className="type-caption min-w-0 flex-1 tabular-nums">
          PR #{review.number} · {providerName(review.provider)}
        </span>
        {onShowFiles && (
          <Button size="sm" variant="ghost" onClick={onShowFiles}>
            <ArrowLeft size={14} strokeWidth={1.8} />
            Back to files
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void window.electronAPI.openExternal(review.url)}
        >
          <ExternalLink size={14} strokeWidth={1.8} />
          Open on {providerName(review.provider)}
        </Button>
      </div>
      <h1 className="type-title wrap-break-word">{review.title}</h1>
      <DetailList>
        <DetailItem label="State">
          <Badge size="sm">{STATE_LABELS[review.state]}</Badge>
          {review.author && <span className="text-ink-2"> by {review.author}</span>}
        </DetailItem>
        <DetailItem label="Branches" title={`${review.baseRef} ← ${review.headRef}`}>
          {review.baseRef} ← {review.headRef}
        </DetailItem>
        <DetailItem label="Commits">
          <span className="tabular-nums">{distanceLine(review)}</span>
        </DetailItem>
        {/* ADO has no assignees. */}
        {review.provider === 'github' && (
          <DetailItem label="Assignees" title={review.assignees.join(', ')}>
            {review.assignees.length > 0 ? review.assignees.join(', ') : 'None'}
          </DetailItem>
        )}
      </DetailList>
    </header>
  );
}

function Reviewers({ review }: { review: PrReview }) {
  return (
    <DetailSection title="Reviewers">
      {review.reviewers.length === 0 ? (
        <p className="type-caption px-2.5">None.</p>
      ) : (
        <ul className="grid gap-1">
          {review.reviewers.map((r) => (
            <li key={r.name} className="flex min-h-6 flex-wrap items-baseline gap-x-2">
              <span className="type-body wrap-anywhere">{r.name}</span>
              <span className="type-caption">{REVIEWER_LABELS[r.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

/** A check's state as a neutral icon: CI state isn't agent state, so no colour;
 *  a running check pulses, as the PR icons do. */
function CheckIcon({ state }: { state: PrCheck['state'] }) {
  const props = { size: 14, strokeWidth: 1.8, className: 'text-icon' };
  switch (state) {
    case 'passing':
      return <CircleCheck {...props} />;
    case 'failing':
      return <CircleX {...props} />;
    case 'pending':
      return <CircleDashed {...props} className={cn(props.className, ciPulse('pending'))} />;
    case 'skipped':
      return <CircleMinus {...props} />;
  }
}

function Checks({ checks }: { checks: PrCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <DetailSection title="Checks">
      <div className="grid gap-px">
        {checks.map((c, i) => {
          const url = c.url;
          return (
            <ListRow
              key={`${c.name}:${i}`}
              size="sm"
              leading={<CheckIcon state={c.state} />}
              trailing={
                <>
                  <span className="type-caption">{CHECK_LABELS[c.state]}</span>
                  {url && <ExternalLink size={14} strokeWidth={1.8} className="text-icon" />}
                </>
              }
              as={url ? 'button' : 'div'}
              title={url ? `Open ${c.name}` : c.name}
              onClick={url ? () => void window.electronAPI.openExternal(url) : undefined}
            >
              {c.name}
            </ListRow>
          );
        })}
      </div>
    </DetailSection>
  );
}

function Conversation({ comments, forge }: { comments: PrReviewComment[]; forge: string }) {
  const now = Date.now() / 1000;
  return (
    <DetailSection title="Conversation">
      {comments.length === 0 ? (
        <p className="type-caption px-2.5">No comments.</p>
      ) : (
        <ol className="grid gap-3 px-2.5">
          {comments.map((c) => (
            <li key={c.id} className="grid gap-1 rounded-lg border border-line px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="type-subheading min-w-0 truncate">{c.author}</span>
                <span className="type-caption" title={c.createdAt}>
                  {formatTimeAgo(Date.parse(c.createdAt) / 1000, now)}
                </span>
                <span className="flex-1" />
                {c.url && (
                  <IconButton
                    size="sm"
                    title={`Open on ${forge}`}
                    onClick={() => void window.electronAPI.openExternal(c.url)}
                  >
                    <ExternalLink size={14} strokeWidth={1.8} />
                  </IconButton>
                )}
              </div>
              <div className="type-body">
                <Markdown text={c.body.trim()} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}
