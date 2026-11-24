import type { ReactNode } from 'react';
import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  ExternalLink,
  FileDiff,
  GitCompareArrows,
  MessagesSquare,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { formatTimeAgo } from '../../../shared/relativeTime';
import type { PrCheck, PrReview, PrReviewComment } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { DetailSection } from '../ui/DetailList';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { Markdown } from '../ui/Markdown';
import { TextLink } from '../ui/TextLink';
import { ciPulse } from '../ui/prStatusColors';
import {
  CHECK_LABELS,
  changedFilesLine,
  prDateTime,
  providerName,
  REVIEWER_LABELS,
  threadsLine,
} from './labels';
import { checksSummary } from './outline';

/** One fact about the PR: an icon naming what it is, then the value, which
 *  wraps rather than truncates (the column can be narrow, D85). */
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
 * The Review view's Overview tab: how far the PR is behind its base, what it
 * changes, when it was opened and last moved, its threads, reviewers and
 * assignees; then its checks, its description and the general conversation
 * (read-only, oldest first).
 */
export function ReviewOverview({ review, remote }: { review: PrReview; remote: string | null }) {
  const baseHref = remote ? branchUrl(remote, review.baseRef) : null;
  const threads = threadsLine(review.threads);
  const created = prDateTime(review.createdAt);
  const active = prDateTime(review.lastActivityAt);
  return (
    <div className="grid gap-1 pb-2">
      <div className="grid gap-1.5 px-2.5 pt-2">
        {review.behindBase !== null && (
          <Fact icon={GitCompareArrows} name="Behind base">
            <span className="tabular-nums">{review.behindBase}</span> behind{' '}
            {baseHref ? (
              <TextLink href={baseHref} quiet title={`Open ${review.baseRef} on the forge`}>
                <span className="wrap-anywhere">{review.baseRef}</span>
              </TextLink>
            ) : (
              <span className="wrap-anywhere">{review.baseRef}</span>
            )}
          </Fact>
        )}
        <Fact icon={FileDiff} name="Changes">
          <span className="tabular-nums">{changedFilesLine(review.files)}</span>
        </Fact>
        {(created || active) && (
          <Fact icon={CalendarClock} name="Dates">
            {created && <span className="tabular-nums">Created {created}</span>}
            {created && active && <span className="text-ink-3"> · </span>}
            {active && <span className="tabular-nums">Last activity {active}</span>}
          </Fact>
        )}
        {threads && (
          <Fact icon={MessagesSquare} name="Comment threads">
            <span className="tabular-nums">{threads}</span>
          </Fact>
        )}
        {review.reviewers.length > 0 && (
          <Fact icon={UserCheck} name="Reviewers">
            {review.reviewers.map((r, i) => (
              <span key={r.name}>
                {i > 0 && ', '}
                {r.name} <span className="type-caption">{REVIEWER_LABELS[r.state]}</span>
              </span>
            ))}
          </Fact>
        )}
        {review.assignees.length > 0 && (
          <Fact icon={Users} name="Assignees">
            {review.assignees.join(', ')}
          </Fact>
        )}
      </div>
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
    </div>
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
    <DetailSection title={`Checks · ${checksSummary(checks)}`} collapsible>
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
  if (comments.length === 0) return null;
  const now = Date.now() / 1000;
  return (
    <DetailSection title={`Conversation · ${comments.length}`} collapsible>
      <ol className="grid gap-2 px-2.5">
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
    </DetailSection>
  );
}
