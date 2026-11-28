import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { prScope } from '../../../shared/prScope';
import type { PrReview, RelevantPr } from '../../../shared/types';
import { useSectionOpen } from '../../lib/useSectionOpen';
import { useUi } from '../../stores/uiStore';
import { useCommentsStore } from '../../stores/commentsStore';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import type { ReviewLanding } from '../rightInspector/sidebarState';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DetailSection } from '../ui/DetailList';
import { Tooltip } from '../ui/Tooltip';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import { draftCount, pendingReviewLine, unsentNoteCount } from './finishReview';
import { reviewComments } from './outline';
import {
  needsDetails,
  otherAssignees,
  prHead,
  prInvolvement,
  type DetailsFetch,
  type Involvement,
  type PrCardReview,
} from './prList';
import { ReviewHeader } from './ReviewHeader';
import { Checks, PrAbout } from './ReviewOverview';

/** Per PR (`prKey`): when its details were last asked for, this session. */
const fetched = new Map<string, DetailsFetch>();

/**
 * A task's PR's full review (reviewers, checks, threads, how the person is
 * part of it, and the files and commits git reads at the task's checkout),
 * fetched as its About opens when `needsDetails` says so, and kept in the
 * review store, which shares a fetch under way. `review` is null until first
 * fetched; `error`: why the last fetch failed (the last fetched review, if
 * any, stays). The project page reads its PRs' forge alone instead
 * (`usePrDetails`).
 */
function useTaskPrReview(
  at: { projectId: string; cwd: string },
  pr: Pick<RelevantPr, 'provider' | 'number' | 'updatedAt'>,
  open: boolean,
): { review: PrReview | null; error: string | null } {
  const key = prKey(pr.provider, pr.number);
  const review = usePrReviews((s) => s.byPr[key] ?? null);
  const [error, setError] = useState<string | null>(null);
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
      .then((r) => setError(r.ok ? null : r.error));
  }, [open, key, updatedAt, projectId, cwd, number]);
  return { review, error };
}

/** The task's review of `pr` still in hand: its drafts, as Finish review
 *  counts them, and its notes not yet sent to the agent. None without a task. */
function usePendingReview(taskId: string | null, pr: Pick<RelevantPr, 'provider' | 'number'>) {
  const scope = prScope(pr.provider, pr.number);
  const comments = useCommentsStore((s) =>
    taskId && s.taskId === taskId ? reviewComments(s.byFile, scope).length : 0,
  );
  const notes = useCommentsStore((s) =>
    taskId && s.taskId === taskId ? unsentNoteCount(s.byFile, scope) : 0,
  );
  const summary = useTaskReview(taskId, pr).summary?.body ?? '';
  return {
    drafts: draftCount(comments, summary),
    notes,
    line: pendingReviewLine({ drafts: comments, summary, notes }),
  };
}

/**
 * One PR in the task's PRs view (`PrCard`), its full review fetched through
 * the task's checkout as its About opens. About's fold is kept for the
 * session, per PR (`defaultOpen` until the person folds it).
 */
export function ListedPr({
  pr,
  taskId,
  at,
  remote,
  defaultOpen,
  onReview,
}: {
  pr: RelevantPr;
  /** The task whose drafts and notes it counts. */
  taskId: string;
  /** Where its details are fetched: the project and a checkout of it. */
  at: { projectId: string; cwd: string };
  /** The project's remote: where branch and people links point. */
  remote: string | null;
  defaultOpen: boolean;
  /** Enter review mode on it, on Overview or the view given. */
  onReview: (on?: ReviewLanding) => void;
}) {
  const sectionId = `prs.${prKey(pr.provider, pr.number)}`;
  const about = useSectionOpen(sectionId, defaultOpen);
  const { review, error } = useTaskPrReview(at, pr, about.open);
  return (
    <PrCard
      pr={pr}
      review={review}
      error={error}
      remote={remote}
      taskId={taskId}
      about={about}
      sectionId={sectionId}
      onReview={onReview}
    />
  );
}

/**
 * A PR drawn with review mode's own pieces, wherever PRs are listed (the
 * task's PRs view, the project page's Pull requests): its head
 * (`ReviewHeader`: state, title to the forge, who wants to merge what into
 * what) with the way into review mode at its end, then About (`PrAbout`) as a
 * band that folds, led by how the person is part of it (neutral badges:
 * involvement isn't state) and closed by the task's review of it still in
 * hand, and its Checks band. Its commits, files and threads counts enter
 * review mode on History, Files and Threads, as review mode's own do; the
 * commits and files only where git read them (`PrCardReview`). The caller
 * fetches `review` as About opens; till then the band, folded, carries the
 * listing's checks.
 */
export function PrCard({
  pr,
  review,
  error,
  remote,
  taskId,
  about,
  sectionId,
  onReview,
}: {
  pr: RelevantPr;
  /** Its review as last fetched; null until it has been. */
  review: PrCardReview | null;
  /** Why the last fetch failed; null after a good one. */
  error: string | null;
  /** The project's remote: where branch and people links point. */
  remote: string | null;
  /** The task whose drafts and notes it counts; null where none is on it. */
  taskId: string | null;
  /** About's fold (`useSectionOpen`). */
  about: { open: boolean; onOpenChange: (open: boolean) => void };
  /** Where its folds are kept: About's, and Checks' under it. */
  sectionId: string;
  /** Enter review mode on it, on Overview or the view given. */
  onReview: (on?: ReviewLanding) => void;
}) {
  const pending = usePendingReview(taskId, pr);
  return (
    <section>
      <ReviewHeader
        review={prHead(pr, review, remote)}
        remote={remote}
        error={review && error}
        onShowCommits={() => onReview('history')}
        action={
          <Tooltip content="Its files, threads and commits, in review mode">
            <Button variant="secondary" size="sm" onClick={() => onReview()}>
              Review
            </Button>
          </Tooltip>
        }
      />
      <DetailSection
        title="About"
        collapsible
        {...about}
        closedHint={!review && pr.ci && <ChecksRollupIcon ci={pr.ci} />}
      >
        {review ? (
          <PrAbout
            review={review}
            remote={remote}
            assignees={otherAssignees(review)}
            onShowFiles={() => onReview('files')}
            onShowThreads={() => {
              useUi.getState().setReviewThreadsPane('threads');
              onReview('threads');
            }}
            lead={<You involvement={prInvolvement(review)} />}
            tail={pending.line && <PendingReview {...pending} line={pending.line} />}
          />
        ) : (
          <p className="type-caption" role="status">
            {error ? `Could not fetch its details: ${error}` : 'Fetching its details…'}
          </p>
        )}
      </DetailSection>
      {review && <Checks checks={review.checks} sectionId={`${sectionId}.checks`} />}
    </section>
  );
}

/** "You [Author] [Assigned]": how the person is part of the PR; nothing when
 *  they aren't. */
function You({ involvement }: { involvement: Involvement[] }) {
  if (involvement.length === 0) return null;
  return (
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
  );
}

/** "2 drafts, 1 note to send": the task's review of the PR not yet posted. */
function PendingReview({ drafts, notes, line }: { drafts: number; notes: number; line: string }) {
  return (
    <li className="tabular-nums">
      <Tooltip
        content={{
          icon: Pencil,
          title: 'Your review, not posted',
          rows: [
            { label: 'Drafts', value: drafts },
            { label: 'Notes to send', value: notes },
          ],
        }}
      >
        <span className="inline-flex items-center gap-1.5 align-top">
          <Pencil size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
          {line}
        </span>
      </Tooltip>
    </li>
  );
}
