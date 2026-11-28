import { useEffect, useState, type ReactNode } from 'react';
import {
  CircleCheck,
  CircleDashed,
  FileDiff,
  MessageSquare,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
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
import { FoldCard } from '../ui/FoldCard';
import { LineStats } from '../ui/LineStats';
import { PrStateBadge } from '../ui/PrBadge';
import { TextLink } from '../ui/TextLink';
import { Tooltip } from '../ui/Tooltip';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import { draftCount, pendingReviewLine, unsentNoteCount } from './finishReview';
import { plural } from './labels';
import { checksRollup, reviewComments } from './outline';
import {
  needsDetails,
  otherAssignees,
  prCardFacts,
  prHead,
  type DetailsFetch,
  type PrCardReview,
  type ReviewVerdict,
} from './prList';
import { PrMergeLine, PrTitle } from './ReviewHeader';
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

/** The verdict's word and mark: neutral, as a review's standing isn't the
 *  PR's state (D133) nor an agent's. */
const VERDICTS: Record<ReviewVerdict, { label: string; icon: LucideIcon; title: string }> = {
  approved: { label: 'Approved', icon: CircleCheck, title: 'Its reviewers have approved it' },
  changes_requested: {
    label: 'Changes requested',
    icon: FileDiff,
    title: 'A reviewer asked for changes',
  },
  pending: {
    label: 'Review required',
    icon: CircleDashed,
    title: "A review it needs hasn't come in yet",
  },
};

/**
 * A PR as a drawer (`FoldCard`), wherever PRs are listed (the task's PRs
 * view, the project page's Pull requests). Its head always shows what to
 * know at a glance: the title row (`PrTitle`: state, title to the forge,
 * number) with the way into review mode at its end, who wants to merge what
 * into what (`PrMergeLine`), then its state, the review's verdict, the diff
 * totals, open threads, checks and how the person is part of it
 * (`prCardFacts`: the listing's until the review is fetched). Unfolded: the
 * rest of About (dates, reviewers, assignees, issues, the task's review
 * still in hand) and the Checks band. Its commits, files and threads counts
 * enter review mode on History, Files and Threads; the commits and files only
 * where git read them (`PrCardReview`). The caller fetches `review` as it
 * unfolds.
 */
export function PrCard({
  pr,
  review,
  error,
  remote,
  taskId,
  about,
  sectionId,
  actions,
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
  /** The card's fold (`useSectionOpen`). */
  about: { open: boolean; onOpenChange: (open: boolean) => void };
  /** Where its folds are kept: the card's, and Checks' under it. */
  sectionId: string;
  /** More ways on from it, before Review (the project page's task). */
  actions?: ReactNode;
  /** Enter review mode on it, on Overview or the view given. */
  onReview: (on?: ReviewLanding) => void;
}) {
  const pending = usePendingReview(taskId, pr);
  const head = prHead(pr, review, remote);
  const facts = prCardFacts(pr, review);
  const ci = (review && checksRollup(review.checks)) ?? pr.ci;
  const showThreads = () => {
    useUi.getState().setReviewThreadsPane('threads');
    onReview('threads');
  };
  return (
    <FoldCard
      {...about}
      label="this pull request"
      head={(fold) => (
        <>
          <PrTitle
            review={head}
            lead={fold}
            action={
              <div className="flex items-center gap-1.5">
                {actions}
                <Tooltip content="Its files, threads and commits, in review mode">
                  <Button variant="secondary" size="sm" onClick={() => onReview()}>
                    Review
                  </Button>
                </Tooltip>
              </div>
            }
          />
          <PrMergeLine review={head} remote={remote} onShowCommits={() => onReview('history')} />
          <div className="type-caption flex flex-wrap items-center gap-x-3 gap-y-1.5 tabular-nums">
            <PrStateBadge state={head.state} />
            {facts.verdict && <Verdict verdict={facts.verdict} />}
            {(facts.additions !== null || facts.files !== null) && (
              <span className="flex items-center gap-1.5">
                {facts.files !== null && (
                  <TextLink title="Show them in Files" onClick={() => onReview('files')}>
                    {plural(facts.files, 'file')}
                  </TextLink>
                )}
                {facts.additions !== null && facts.deletions !== null && (
                  <LineStats add={facts.additions} del={facts.deletions} />
                )}
              </span>
            )}
            {facts.threads && facts.threads.total > 0 && (
              <Tooltip
                content={`${facts.threads.open} unresolved of ${plural(facts.threads.total, 'thread')}`}
              >
                <span>
                  <TextLink title="Show them in Threads" onClick={showThreads}>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare size={14} strokeWidth={1.8} aria-hidden />
                      {facts.threads.open} of {facts.threads.total}
                    </span>
                  </TextLink>
                </span>
              </Tooltip>
            )}
            {ci && <ChecksRollupIcon ci={ci} />}
            {facts.involvement.map((i) => (
              <Tooltip key={i.key} content={i.title}>
                <Badge size="sm">{i.label}</Badge>
              </Tooltip>
            ))}
          </div>
          {review && error && (
            <p className="type-caption wrap-break-word" role="status">
              Could not reload: {error}
            </p>
          )}
        </>
      )}
    >
      <div className="px-3 pt-2.5 pb-2">
        {review ? (
          <PrAbout
            review={review}
            remote={remote}
            counts={false}
            assignees={otherAssignees(review)}
            tail={pending.line && <PendingReview {...pending} line={pending.line} />}
          />
        ) : (
          <p className="type-caption" role="status">
            {error ? `Could not fetch its details: ${error}` : 'Fetching its details…'}
          </p>
        )}
      </div>
      {review && <Checks checks={review.checks} sectionId={`${sectionId}.checks`} />}
    </FoldCard>
  );
}

/** "✓ Approved": the review's verdict, a quiet mark and its word. */
function Verdict({ verdict }: { verdict: ReviewVerdict }) {
  const { label, icon: Icon, title } = VERDICTS[verdict];
  return (
    <Tooltip content={title}>
      <span className="flex items-center gap-1 text-ink-2">
        <Icon size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
        {label}
      </span>
    </Tooltip>
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
