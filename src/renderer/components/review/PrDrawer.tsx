import { Fragment, useEffect, useState } from 'react';
import { ExternalLink, MessageSquare, Pencil } from 'lucide-react';
import { formatTimeAgo } from '@shared/relativeTime';
import { prScope } from '../../../shared/prScope';
import type { PrReview, RelevantPr } from '../../../shared/types';
import { githubProfileUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { useSectionOpen } from '../../lib/useSectionOpen';
import { useCommentsStore } from '../../stores/commentsStore';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DetailSection } from '../ui/DetailList';
import { IconButton } from '../ui/IconButton';
import { LineStats } from '../ui/LineStats';
import { PrStateBadge } from '../ui/PrBadge';
import { Tooltip } from '../ui/Tooltip';
import { ciLabel, prStateIcon, prStatusText, shownPrState } from '../ui/prStatusColors';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import { draftCount, pendingReviewLine, unsentNoteCount } from './finishReview';
import { plural, providerName } from './labels';
import { checksRollup, checksSummary, reviewComments } from './outline';
import {
  needsDetails,
  prInvolvement,
  type DetailsFetch,
  type PrSide,
  otherAssignees,
} from './prList';
import { Person, Reviewers } from './ReviewOverview';

/** Per PR (`prKey`): when its details were last asked for, this session. */
const fetched = new Map<string, DetailsFetch>();

/**
 * A PR's details (its full review: reviewers, checks, threads, how the
 * person is part of it), fetched as its drawer opens when `needsDetails`
 * says so, and kept in the review store, which shares a fetch under way.
 * `review` is null until first fetched; `failed`: the last fetch failed
 * (the last fetched review, if any, stays).
 */
function usePrDetails(
  at: { projectId: string; cwd: string },
  pr: Pick<RelevantPr, 'provider' | 'number' | 'updatedAt'>,
  open: boolean,
): { review: PrReview | null; failed: boolean } {
  const key = prKey(pr.provider, pr.number);
  const review = usePrReviews((s) => s.byPr[key] ?? null);
  const [failed, setFailed] = useState(false);
  const { projectId, cwd } = at;
  const { number, updatedAt } = pr;
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    if (!needsDetails(fetched.get(key), updatedAt, now)) return;
    fetched.set(key, { at: now, updatedAt });
    void usePrReviews
      .getState()
      .load(projectId, cwd, number)
      .then((r) => setFailed(!r.ok));
  }, [open, key, updatedAt, projectId, cwd, number]);
  return { review, failed };
}

/** The task's review of `pr` still in hand: its drafts, as Finish review
 *  counts them, and its notes not yet sent to the agent. */
function usePendingReview(taskId: string, pr: Pick<RelevantPr, 'provider' | 'number'>) {
  const scope = prScope(pr.provider, pr.number);
  const comments = useCommentsStore((s) =>
    s.taskId === taskId ? reviewComments(s.byFile, scope).length : 0,
  );
  const notes = useCommentsStore((s) =>
    s.taskId === taskId ? unsentNoteCount(s.byFile, scope) : 0,
  );
  const summary = useTaskReview(taskId, pr).summary?.body ?? '';
  return {
    drafts: draftCount(comments, summary),
    notes,
    line: pendingReviewLine({ drafts: comments, summary, notes }),
  };
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One PR as a drawer (a collapsible `DetailSection`, built like review
 * mode's Overview): its state icon and title on the band, the checks while
 * folded, its forge link at the band's end. Open, its state (D133's colour)
 * and branches, then a bulleted list as About's: how the person is part of
 * it (neutral badges: involvement isn't state), its reviewers and assignees,
 * checks, threads and lines, and the task's review of it still in hand;
 * then the way into review mode. The listing's facts show at once; the rest
 * once its details are fetched, as the drawer opens. Its fold is kept for
 * the session, per PR (`defaultOpen` until the person folds it).
 */
export function PrDrawer({
  pr,
  side,
  taskId,
  at,
  remote,
  defaultOpen,
  onReview,
}: {
  pr: RelevantPr;
  /** Which end of it the task's branch is; the meta line names the other. */
  side: PrSide;
  /** The task whose drafts and notes it counts. */
  taskId: string;
  /** Where its details are fetched: the project and a checkout of it. */
  at: { projectId: string; cwd: string };
  /** The project's remote, for assignees' profile links. */
  remote: string | null;
  defaultOpen: boolean;
  /** Enter review mode on it. */
  onReview: () => void;
}) {
  const section = useSectionOpen(`prs.${prKey(pr.provider, pr.number)}`, defaultOpen);
  const { review, failed } = usePrDetails(at, pr, section.open);
  const pending = usePendingReview(taskId, pr);
  const state = review?.state ?? shownPrState(pr);
  const Icon = prStateIcon(state);
  const ci = review ? checksRollup(review.checks) : pr.ci;
  const threads = review
    ? {
        open: review.threads.filter((t) => !t.resolved).length,
        total: review.threads.length,
      }
    : pr.threads;
  const involvement = review ? prInvolvement(review) : [];
  const others = review ? otherAssignees(review) : [];
  const updated = pr.updatedAt ? Date.parse(pr.updatedAt) / 1000 : NaN;
  const forge = providerName(pr.provider);

  return (
    <DetailSection
      collapsible
      {...section}
      title={
        <span className="inline-flex items-start gap-2">
          <span className={cn('flex h-5 shrink-0 items-center', prStatusText(state))}>
            <Icon size={14} strokeWidth={1.8} aria-label={`${state} pull request`} />
          </span>
          <span className="wrap-break-word">
            <span className="tabular-nums">#{pr.number}</span> {pr.title}
          </span>
        </span>
      }
      closedHint={ci && <ChecksRollupIcon ci={ci} />}
      action={
        <IconButton
          size="sm"
          title={`Open #${pr.number} on ${forge}`}
          description={pr.url}
          onClick={() => void window.electronAPI.openExternal(pr.url)}
        >
          <ExternalLink size={14} strokeWidth={1.8} />
        </IconButton>
      }
    >
      <div className="grid gap-2.5 pt-0.5">
        <p className="type-caption flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
          <PrStateBadge state={state} />
          <span className="wrap-anywhere">
            {pr.author}
            {side === 'into' ? ` ← ${pr.headRefName}` : ` → ${pr.baseRefName}`}
          </span>
          {!Number.isNaN(updated) && (
            <span>updated {formatTimeAgo(updated, Date.now() / 1000)}</span>
          )}
        </p>
        <ul className="type-body grid list-disc gap-1 pl-4 wrap-break-word marker:text-ink-3">
          {involvement.length > 0 && (
            <li>
              <span className="type-label">You</span>{' '}
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {involvement.map((i) => (
                  <Tooltip key={i.key} content={i.title}>
                    <Badge size="sm">{i.label}</Badge>
                  </Tooltip>
                ))}
              </span>
            </li>
          )}
          {review && <Reviewers reviewers={review.reviewers} />}
          {others.length > 0 && (
            <li>
              Assigned to{' '}
              {others.map((a, i) => (
                <Fragment key={a}>
                  {i > 0 && ', '}
                  <Person name={a} url={githubProfileUrl(remote, a)} />
                </Fragment>
              ))}
            </li>
          )}
          {ci && (
            <li>
              <span className="inline-flex items-center gap-1.5 align-top tabular-nums">
                <ChecksRollupIcon ci={ci} />
                {(review && checksSummary(review.checks)) ?? sentence(ciLabel(ci))}
              </span>
            </li>
          )}
          {threads && threads.total > 0 && (
            <li className="tabular-nums">
              <span className="inline-flex items-center gap-1.5 align-top">
                <MessageSquare size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
                {plural(threads.total, 'thread')},{' '}
                {threads.open > 0 ? `${threads.open} unresolved` : 'all resolved'}
              </span>
            </li>
          )}
          {pr.additions !== null && pr.deletions !== null && (
            <li className="tabular-nums">
              <LineStats add={pr.additions} del={pr.deletions} />
            </li>
          )}
          {pending.line && (
            <li className="tabular-nums">
              <Tooltip
                content={{
                  icon: Pencil,
                  title: 'Your review, not posted',
                  rows: [
                    { label: 'Drafts', value: pending.drafts },
                    { label: 'Notes to send', value: pending.notes },
                  ],
                }}
              >
                <span className="inline-flex items-center gap-1.5 align-top">
                  <Pencil size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
                  {pending.line}
                </span>
              </Tooltip>
            </li>
          )}
        </ul>
        {!review && (
          <p className="type-caption">
            {failed ? `Couldn't reach ${forge} for its reviewers.` : 'Fetching its reviewers…'}
          </p>
        )}
        <div>
          <Tooltip content="Its files, threads and commits, in review mode">
            <Button variant="secondary" size="sm" onClick={onReview}>
              Review
            </Button>
          </Tooltip>
        </div>
      </div>
    </DetailSection>
  );
}
