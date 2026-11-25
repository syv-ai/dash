import { Fragment } from 'react';
import { CircleCheck, CircleDashed, CircleMinus, CircleX, ExternalLink } from 'lucide-react';
import type { PrCheck, PrReview, PrReviewer } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { DetailSection } from '../ui/DetailList';
import { LineStats } from '../ui/LineStats';
import { ListRow } from '../ui/ListRow';
import { Markdown } from '../ui/Markdown';
import { TextLink } from '../ui/TextLink';
import { ciPulse } from '../ui/prStatusColors';
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
    <TextLink href={url} quiet title={`${name}'s profile`}>
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

/**
 * The Review view's Overview tab, under the PR's header: a line leading to
 * Finish review… when there is one to give ("2 drafts · Finish review…"),
 * then About (a bulleted list: how far the PR is behind its base, when it was
 * opened and last moved, its files and lines changed, threads, reviewers and
 * assignees), its checks and its description, each a band that folds; the
 * open ones are remembered for the session. The general conversation lives
 * in the Comments tab.
 */
export function ReviewOverview({
  review,
  remote,
  finish,
}: {
  review: PrReview;
  remote: string | null;
  /** The person's drafts (comments and replies) and opening the
   *  Finish-review sheet; absent while there is nothing to finish. */
  finish?: { drafts: number; onOpen: () => void };
}) {
  const about = useSectionOpen('overview.about', true);
  const description = useSectionOpen('overview.description', true);
  const baseHref = remote ? branchUrl(remote, review.baseRef) : null;
  const threads = threadsLine(review.threads);
  const totals = diffTotals(review.files);
  const created = prDateTime(review.createdAt);
  const active = prDateTime(review.lastActivityAt);
  return (
    <div className="pt-2 pb-2">
      {finish && (
        <p className="type-body px-3 pb-2 tabular-nums">
          {finish.drafts > 0 && `${plural(finish.drafts, 'draft')} · `}
          <TextLink onClick={finish.onOpen}>Finish review…</TextLink>
        </p>
      )}
      <DetailSection title="About" collapsible {...about}>
        {/* Plain facts, one bullet each; values wrap rather than truncate (the
            column can be narrow, D85). */}
        <div className="pt-0.5">
          <ul className="type-body grid list-disc gap-1 pl-4 wrap-break-word marker:text-ink-3">
            {!!review.behindBase && (
              <li>
                <span className="tabular-nums">{review.behindBase}</span> behind{' '}
                {baseHref ? (
                  <TextLink href={baseHref} quiet title={`Open ${review.baseRef} on the forge`}>
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
