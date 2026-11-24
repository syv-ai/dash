import { useMemo, useState } from 'react';
import { GitPullRequestArrow } from 'lucide-react';
import { prScope } from '../../../shared/prScope';
import type { Task, TaskReviewTarget } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { useTaskBranch } from '../../stores/gitStore';
import { useProjects } from '../../stores/projectsStore';
import { usePrReviews } from '../../stores/prReviewStore';
import { useUi, type ReviewTab } from '../../stores/uiStore';
import type { PrCommitsRange } from '../diffEditor/data/usePrCommits';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import { DockedPanel } from '../ui/DockedPanel';
import { EmptyState } from '../ui/EmptyState';
import { Segmented } from '../ui/Segmented';
import { finishOffered, unsentNoteCount } from './finishReview';
import { FinishReviewSheet } from './FinishReviewSheet';
import { communicationCounts } from './labels';
import { NotesTray } from './NotesTray';
import { communicationTally, fileRows, replyDraftCounts, reviewComments } from './outline';
import { ReviewChanges } from './ReviewChanges';
import { ReviewHeader } from './ReviewHeader';
import { ReviewOverview } from './ReviewOverview';
import { ReviewThreads } from './ReviewThreads';
import { onPrHeadBranch } from './unpushed';
import { UnpushedNotice } from './UnpushedNotice';
import { useReviewData } from './useReviewData';
import { YourReview } from './YourReview';

interface ReviewViewProps {
  task: Task;
  /** The task's review target and why; undefined while it loads. */
  target: TaskReviewTarget | null | undefined;
  /** Review PR `number` instead (Switch PR…); resolves false when it couldn't be loaded. */
  onSwitchPr: (number: number) => Promise<boolean>;
  /** The file showing in the focused editor group. */
  activePath: string | null;
  /** Open a file of the PR in the PR view, expanding the sidebar. */
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  /** The editor shows one group (a file's menu offers "Open in new pane"). */
  canOpenToSide: boolean;
  /** Show the PR's commits in History: the branch's own list when the checkout
   *  is on the PR's head branch (null), else the PR's base..head. */
  onShowCommits: (range: PrCommitsRange | null) => void;
  /** Show a draft or note where it was written. */
  onNavigate: (scope: string, path: string, commentId: string) => void;
}

const TABS: { value: ReviewTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'changes', label: 'Changes' },
];

/**
 * The task sidebar's Review view, for the PR the task reviews: the header,
 * then Overview | Changes, then the Communication bar docked at the bottom
 * (threads, the person's drafts, the notes to the agent). Narrow it is the
 * whole column; expanded, the list column beside the editor's PR view.
 */
export function ReviewView({ target, ...rest }: ReviewViewProps) {
  if (!target) return <EmptyState title="Loading…" />;
  return <Review key={`${target.provider}:${target.number}`} target={target} {...rest} />;
}

function Review({
  task,
  target,
  onSwitchPr,
  activePath,
  onOpenFile,
  canOpenToSide,
  onShowCommits,
  onNavigate,
}: Omit<ReviewViewProps, 'target'> & { target: TaskReviewTarget }) {
  const { review, marks, error, loading, refresh } = useReviewData({
    taskId: task.id,
    projectId: task.projectId,
    cwd: task.path,
    target,
  });
  const remote = useProjects(
    (s) => s.projects.find((p) => p.id === task.projectId)?.gitRemote ?? null,
  );
  const branch = useTaskBranch(task);
  const tab = useUi((s) => s.reviewTab);
  const commsOpen = useUi((s) => s.reviewCommsOpen);
  const [finishing, setFinishing] = useState(false);
  const scope = prScope(target.provider, target.number);
  const commentsReady = useCommentsStore((s) => s.taskId === task.id && !s.disabled);
  const byFile = useCommentsStore((s) => s.byFile);
  const comments = useMemo(() => reviewComments(byFile, scope), [byFile, scope]);
  const rows = useMemo(
    () => (review ? fileRows(review.files, review.threads, marks, comments) : []),
    [review, marks, comments],
  );
  const replyDrafts = useMemo(() => replyDraftCounts(comments), [comments]);
  const { summary } = useTaskReview(task.id, target);

  if (!review) {
    return error ? (
      <EmptyState
        icon={<GitPullRequestArrow size={14} strokeWidth={1.8} />}
        title={`Could not load PR #${target.number}`}
        description={error}
      />
    ) : (
      <EmptyState title="Loading…" />
    );
  }

  const tally = communicationTally(review.threads, comments, byFile);
  const canFinish =
    commentsReady &&
    finishOffered({ own: review.viewerIsAuthor, comments, summary: summary?.body ?? '' });
  const showCommits = () =>
    onShowCommits(
      onPrHeadBranch(target.source, review.headRef, branch)
        ? null
        : { number: review.number, base: review.base, head: review.head },
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-gutter-stable scrollbar-thin-hover flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ReviewHeader
          review={review}
          source={target.source}
          projectId={task.projectId}
          cwd={task.path}
          remote={remote}
          loading={loading}
          error={error}
          onRefresh={refresh}
          onSwitch={onSwitchPr}
          onStop={() => usePrReviews.getState().setTarget(task.id, null)}
          onShowCommits={showCommits}
          onFinish={canFinish ? () => setFinishing(true) : undefined}
        />
        <UnpushedNotice task={task} review={review} source={target.source} />
        <div className="shrink-0 px-2.5 pt-1.5 pb-1">
          <Segmented<ReviewTab>
            aria-label="Review tab"
            size="sm"
            fullWidth={false}
            value={tab}
            onChange={(next) => useUi.getState().setReviewTab(next)}
            options={TABS}
          />
        </div>
        {tab === 'overview' ? (
          <ReviewOverview review={review} remote={remote} />
        ) : (
          <div className="min-h-0 flex-1">
            <ReviewChanges
              review={review}
              rows={rows}
              cwd={task.path}
              activePath={activePath}
              canOpenToSide={canOpenToSide}
              onOpenFile={onOpenFile}
            />
          </div>
        )}
      </div>
      <DockedPanel
        title="Communication"
        summary={communicationCounts(tally)}
        open={commsOpen}
        onOpenChange={(open) => useUi.getState().setReviewCommsOpen(open)}
      >
        <ReviewThreads
          review={review}
          taskId={task.id}
          projectId={task.projectId}
          cwd={task.path}
          draftScope={commentsReady ? scope : null}
          replyDrafts={replyDrafts}
        />
        {commentsReady && (
          <YourReview
            review={review}
            taskId={task.id}
            projectId={task.projectId}
            cwd={task.path}
            comments={comments}
            onNavigate={onNavigate}
          />
        )}
        <NotesTray taskId={task.id} onNavigate={onNavigate} />
        {tally.open + tally.drafts + tally.notes === 0 && !review.threads.length && (
          <p className="type-caption px-2.5 pt-2">No threads, drafts or notes yet.</p>
        )}
      </DockedPanel>
      {finishing && (
        <FinishReviewSheet
          review={review}
          projectId={task.projectId}
          cwd={task.path}
          taskId={task.id}
          comments={comments}
          noteCount={unsentNoteCount(byFile, scope)}
          onClose={() => setFinishing(false)}
        />
      )}
    </div>
  );
}
