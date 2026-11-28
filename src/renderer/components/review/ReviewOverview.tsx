import { Fragment, type ReactNode } from 'react';
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  MessageSquare,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { PrCheck, PrIssue, PrReview, PrReviewer } from '../../../shared/types';
import { githubProfileUrl } from '../../../shared/urls';
import { DetailSection } from '../ui/DetailList';
import { LineStats } from '../ui/LineStats';
import { ListRow } from '../ui/ListRow';
import { Markdown } from '../ui/Markdown';
import { TextLink } from '../ui/TextLink';
import { CheckStateIcon } from '../ui/CheckStateIcon';
import { Tooltip } from '../ui/Tooltip';
import {
  CHECK_LABELS,
  diffTotals,
  plural,
  prDateTime,
  REVIEWER_STATE_WORDS,
  reviewerRoster,
  threadsResolved,
} from './labels';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import { checksRollup, checksSummary } from './outline';
import { useSectionOpen } from '../../lib/useSectionOpen';
import { cn } from '../../lib/cn';
import type { PrCardReview } from './prList';
import { Branch } from './ReviewHeader';

/** A person, linked to their page on the forge when it has one. */
function Person({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <TextLink href={url} title={`${name}'s profile`}>
      {name}
    </TextLink>
  ) : (
    <span>{name}</span>
  );
}

/** Each reviewer state's mark: neutral, as where a review stands is neither
 *  the PR's state (D133) nor an agent's; its word is the mark's label. */
export const REVIEWER_STATE_ICONS: Record<PrReviewer['state'], LucideIcon> = {
  approved: CircleCheck,
  approved_with_suggestions: CircleCheck,
  changes_requested: CircleX,
  rejected: CircleX,
  waiting: Clock,
  commented: MessageSquare,
  pending: CircleDashed,
};

/**
 * "Reviewers ✓ ann, ⊗ cy, ◌ dee (required)": the PR's reviewers as one roster
 * (`reviewerRoster`), each led by a quiet mark saying where they stand, its
 * word on hover. A group or team adds a people mark, a required reviewer
 * "(required)", and one who declined (ADO) reads in faint ink.
 */
function Reviewers({ reviewers }: { reviewers: PrReviewer[] }) {
  const roster = reviewerRoster(reviewers);
  if (roster.length === 0) return null;
  return (
    <li>
      <span className="type-label">Reviewers</span>{' '}
      {roster.map((r, i) => (
        <Fragment key={r.name}>
          {i > 0 && ', '}
          <Reviewer reviewer={r} />
        </Fragment>
      ))}
    </li>
  );
}

function Reviewer({ reviewer: r }: { reviewer: PrReviewer }) {
  const Mark = REVIEWER_STATE_ICONS[r.state];
  const word = r.declined ? 'Declined to review' : REVIEWER_STATE_WORDS[r.state];
  return (
    <span className={cn('inline-flex items-center gap-1 align-top', r.declined && 'text-ink-3')}>
      <Tooltip content={word}>
        <Mark size={14} strokeWidth={1.8} className="shrink-0 text-icon" aria-label={word} />
      </Tooltip>
      {r.group && (
        <Tooltip content="A group: anyone in it can review">
          <Users size={14} strokeWidth={1.8} className="shrink-0 text-icon" aria-label="Group" />
        </Tooltip>
      )}
      <Person name={r.name} url={r.url} />
      {r.required && (
        <Tooltip content="Their review is required to merge">
          <span className="text-ink-3">(required)</span>
        </Tooltip>
      )}
    </span>
  );
}

/** "Issues #12 It breaks, #14 …": the issues the PR closes (GitHub) or its
 *  work items (ADO), each linked to its page; nothing with none. */
function Issues({ issues }: { issues: PrIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <li>
      <span className="type-label">{issues.length === 1 ? 'Issue' : 'Issues'}</span>{' '}
      {issues.map((issue, i) => (
        <Fragment key={issue.number}>
          {i > 0 && ', '}
          <TextLink href={issue.url} title={`Open #${issue.number} on the forge`}>
            <span className="tabular-nums">#{issue.number}</span>
            {issue.title && ` ${issue.title}`}
          </TextLink>
        </Fragment>
      ))}
    </li>
  );
}

/**
 * The Review view's Overview tab, under the PR's header: About (`PrAbout`),
 * its checks and its description, each a band that folds; the open ones are
 * remembered for the session. The general conversation lives in the Threads
 * tab.
 */
export function ReviewOverview({
  review,
  remote,
  onShowFiles,
  onShowThreads,
}: {
  review: PrReview;
  remote: string | null;
  /** Show the Files tab. */
  onShowFiles: () => void;
  /** Show the Threads tab, on its threads. */
  onShowThreads: () => void;
}) {
  const about = useSectionOpen('overview.about', true);
  const description = useSectionOpen('overview.description', true);
  return (
    <div className="pt-2 pb-2">
      <DetailSection title="About" collapsible {...about}>
        <PrAbout
          review={review}
          remote={remote}
          onShowFiles={onShowFiles}
          onShowThreads={onShowThreads}
        />
      </DetailSection>
      <Checks checks={review.checks} />
      <DetailSection title="Description" collapsible {...description}>
        <div className="type-body">
          {review.body.trim() ? (
            <Markdown text={review.body} />
          ) : (
            <p className="type-caption">No description.</p>
          )}
        </div>
      </DetailSection>
    </div>
  );
}

/**
 * About's facts, a bulleted list (review mode's Overview, the PRs view's
 * PRs): `lead` first, then how far the PR is behind its base, when it was
 * opened and last moved, its files and lines changed (the count a link to
 * Files, given `onShowFiles`; only where git listed them), threads (the count
 * a link to Threads, given `onShowThreads`), reviewers, assignees and linked
 * issues, then `tail`; a card leaves the counts to its head (`counts`). A
 * review read from the forge alone (the project page)
 * has no files and no distance behind base, so says neither.
 */
export function PrAbout({
  review,
  remote,
  assignees = review.assignees,
  onShowFiles,
  onShowThreads,
  lead,
  tail,
  counts = true,
}: {
  review: PrCardReview;
  remote: string | null;
  /** Who "Assigned to" names; the PR's assignees unless given. */
  assignees?: string[];
  onShowFiles?: () => void;
  onShowThreads?: () => void;
  /** Bullets before the PR's facts, and after them. */
  lead?: ReactNode;
  tail?: ReactNode;
  /** Its files, lines and threads counts; false where a card's head already
   *  says them (`PrCard`). */
  counts?: boolean;
}) {
  const resolved = threadsResolved(review.threads);
  const totals = counts && review.files && diffTotals(review.files);
  const created = prDateTime(review.createdAt);
  const active = prDateTime(review.lastActivityAt);
  return (
    // Plain facts, one bullet each; values wrap rather than truncate (the
    // column can be narrow, D85).
    <div className="pt-0.5">
      <ul className="type-body grid list-disc gap-1 pl-4 wrap-break-word marker:text-ink-3">
        {lead}
        {!!review.behindBase && (
          <li>
            <span className="tabular-nums">{review.behindBase}</span> behind{' '}
            <Branch remote={remote} name={review.baseRef} />
          </li>
        )}
        {created && <li className="tabular-nums">Created {created}</li>}
        {active && <li className="tabular-nums">Last activity {active}</li>}
        {totals && (
          <li className="tabular-nums">
            <CountLink title="Show them in Files" onClick={onShowFiles}>
              {plural(totals.files, 'file')} changed
            </CountLink>
            {(totals.additions > 0 || totals.deletions > 0) && ', '}
            <LineStats add={totals.additions} del={totals.deletions} />
          </li>
        )}
        {counts && resolved && (
          <li className="tabular-nums">
            <CountLink title="Show them in Threads" onClick={onShowThreads}>
              {plural(review.threads.length, 'thread')}
            </CountLink>{' '}
            {resolved}
          </li>
        )}
        <Reviewers reviewers={review.reviewers} />
        {assignees.length > 0 && (
          <li>
            Assigned to{' '}
            {assignees.map((a, i) => (
              <Fragment key={a}>
                {i > 0 && ', '}
                <Person name={a} url={githubProfileUrl(remote, a)} />
              </Fragment>
            ))}
          </li>
        )}
        <Issues issues={review.issues} />
        {tail}
      </ul>
    </div>
  );
}

/** A count that links to the view listing what it counts, where one can. */
function CountLink({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return onClick ? (
    <TextLink title={title} onClick={onClick}>
      {children}
    </TextLink>
  ) : (
    <>{children}</>
  );
}

/** The PR's checks as a band that folds, each a row opening its run; folded,
 *  their rollup (Overview's, and each PR's in the PRs view, by `sectionId`). */
export function Checks({
  checks,
  sectionId = 'overview.checks',
}: {
  checks: PrCheck[];
  /** Where its fold is kept (`useSectionOpen`). */
  sectionId?: string;
}) {
  const section = useSectionOpen(sectionId, false);
  const ci = checksRollup(checks);
  if (!ci) return null;
  return (
    <DetailSection
      title="Checks"
      summary={checksSummary(checks)}
      closedHint={<ChecksRollupIcon ci={ci} />}
      collapsible
      {...section}
    >
      <div className="grid gap-px">
        {checks.map((c, i) => {
          const url = c.url;
          return (
            <ListRow
              key={`${c.name}:${i}`}
              size="sm"
              leading={<CheckStateIcon state={c.state} />}
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
