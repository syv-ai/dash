import { Fragment } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PrCheck, PrIssue, PrReview, PrReviewer } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { DetailSection } from '../ui/DetailList';
import { LineStats } from '../ui/LineStats';
import { ListRow } from '../ui/ListRow';
import { Markdown } from '../ui/Markdown';
import { TextLink } from '../ui/TextLink';
import { CheckStateIcon } from '../ui/CheckStateIcon';
import {
  CHECK_LABELS,
  diffTotals,
  plural,
  prDateTime,
  reviewerGroups,
  threadsLine,
} from './labels';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import { checksRollup, checksSummary } from './outline';
import { useSectionOpen } from './useSectionOpen';

/** A person, linked to their page on the forge when it has one. */
function Person({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <TextLink href={url} look="quiet" title={`${name}'s profile`}>
      {name}
    </TextLink>
  ) : (
    <span>{name}</span>
  );
}

/** "Approved by A, B" / "Changes requested by C" / "Review requested from D",
 *  one fact per group. */
function Reviewers({ reviewers }: { reviewers: PrReviewer[] }) {
  return reviewerGroups(reviewers).map((g) => (
    <li key={g.lead}>
      <span className="type-label">{g.lead}</span>{' '}
      {g.reviewers.map((r, i) => (
        <Fragment key={r.name}>
          {i > 0 && ', '}
          <Person name={r.name} url={r.url} />
        </Fragment>
      ))}
    </li>
  ));
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
          <TextLink href={issue.url} look="quiet" title={`Open #${issue.number} on the forge`}>
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
 * opened and last moved, its files and lines changed, threads, reviewers,
 * assignees and linked issues), its checks and its description, each a band that folds; the
 * open ones are remembered for the session. The general conversation lives
 * in the Threads tab.
 */
export function ReviewOverview({ review, remote }: { review: PrReview; remote: string | null }) {
  const about = useSectionOpen('overview.about', true);
  const description = useSectionOpen('overview.description', true);
  const baseHref = remote ? branchUrl(remote, review.baseRef) : null;
  const threads = threadsLine(review.threads);
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
                  <TextLink
                    href={baseHref}
                    look="quiet"
                    title={`Open ${review.baseRef} on the forge`}
                  >
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
              {plural(totals.files, 'file')} changed
              {(totals.additions > 0 || totals.deletions > 0) && ', '}
              <LineStats add={totals.additions} del={totals.deletions} />
            </li>
            {threads && <li className="tabular-nums">{threads}</li>}
            <Reviewers reviewers={review.reviewers} />
            {review.assignees.length > 0 && <li>Assigned to {review.assignees.join(', ')}</li>}
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
