import { Fragment } from 'react';
import { ExternalLink, Users } from 'lucide-react';
import type { PrCheck, PrIssue, PrReview, PrReviewer } from '../../../shared/types';
import { branchUrl, githubProfileUrl } from '../../../shared/urls';
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
  reviewerGroups,
  threadsResolved,
} from './labels';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import { checksRollup, checksSummary } from './outline';
import { useSectionOpen } from '../../lib/useSectionOpen';

/** A person, linked to their page on the forge when it has one. */
export function Person({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <TextLink href={url} title={`${name}'s profile`}>
      {name}
    </TextLink>
  ) : (
    <span>{name}</span>
  );
}

/** "Approved by A, B" / "Changes requested by C" / "Review requested from D"
 *  / "Declined to review: E", one fact per group (Overview's About, the PRs
 *  view's). A required reviewer reads "(required)" after their name, a
 *  group or team leads with a people icon: quiet marks, in the text's ink. */
export function Reviewers({ reviewers }: { reviewers: PrReviewer[] }) {
  return reviewerGroups(reviewers).map((g) => (
    <li key={g.lead}>
      <span className="type-label">{g.lead}</span>{' '}
      {g.reviewers.map((r, i) => (
        <Fragment key={r.name}>
          {i > 0 && ', '}
          <Reviewer reviewer={r} />
        </Fragment>
      ))}
    </li>
  ));
}

function Reviewer({ reviewer: r }: { reviewer: PrReviewer }) {
  const person = <Person name={r.name} url={r.url} />;
  return (
    <>
      {r.group ? (
        <span className="inline-flex items-center gap-1 align-top">
          <Tooltip content="A group: anyone in it can review">
            <Users size={14} strokeWidth={1.8} className="shrink-0 text-icon" aria-label="Group" />
          </Tooltip>
          {person}
        </span>
      ) : (
        person
      )}
      {r.required && (
        <Tooltip content="Their review is required to merge">
          <span className="text-ink-3"> (required)</span>
        </Tooltip>
      )}
    </>
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
 * The Review view's Overview tab, under the PR's header: About (a bulleted list: how far the PR is behind its base, when it was
 * opened and last moved, its files and lines changed (the count a link to
 * Files), threads (the count a link to Threads), reviewers,
 * assignees and linked issues), its checks and its description, each a band that folds; the
 * open ones are remembered for the session. The general conversation lives
 * in the Threads tab.
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
  const baseHref = remote ? branchUrl(remote, review.baseRef) : null;
  const resolved = threadsResolved(review.threads);
  const totals = diffTotals(review.files);
  const created = prDateTime(review.createdAt);
  const active = prDateTime(review.lastActivityAt);
  return (
    <div className="pt-2 pb-2">
      <DetailSection title="About" collapsible {...about}>
        {/* Plain facts, one bullet each; values wrap rather than truncate (the
            column can be narrow, D85). */}
        <div className="pt-0.5">
          <ul className="type-body grid list-disc gap-1 pl-4 wrap-break-word marker:text-ink-3">
            {!!review.behindBase && (
              <li>
                <span className="tabular-nums">{review.behindBase}</span> behind{' '}
                {baseHref ? (
                  <TextLink href={baseHref} title={`Open ${review.baseRef} on the forge`}>
                    <span className="wrap-anywhere">{review.baseRef}</span>
                  </TextLink>
                ) : (
                  <span className="wrap-anywhere">{review.baseRef}</span>
                )}
              </li>
            )}
            {created && <li className="tabular-nums">Created {created}</li>}
            {active && <li className="tabular-nums">Last activity {active}</li>}
            <li className="tabular-nums">
              <TextLink title="Show them in Files" onClick={onShowFiles}>
                {plural(totals.files, 'file')} changed
              </TextLink>
              {(totals.additions > 0 || totals.deletions > 0) && ', '}
              <LineStats add={totals.additions} del={totals.deletions} />
            </li>
            {resolved && (
              <li className="tabular-nums">
                <TextLink title="Show them in Threads" onClick={onShowThreads}>
                  {plural(review.threads.length, 'thread')}
                </TextLink>{' '}
                {resolved}
              </li>
            )}
            <Reviewers reviewers={review.reviewers} />
            {review.assignees.length > 0 && (
              <li>
                Assigned to{' '}
                {review.assignees.map((a, i) => (
                  <Fragment key={a}>
                    {i > 0 && ', '}
                    <Person name={a} url={githubProfileUrl(remote, a)} />
                  </Fragment>
                ))}
              </li>
            )}
            <Issues issues={review.issues} />
          </ul>
        </div>
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

function Checks({ checks }: { checks: PrCheck[] }) {
  const section = useSectionOpen('overview.checks', false);
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
