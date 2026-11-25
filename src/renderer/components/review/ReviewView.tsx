import { useMemo, useState, type ReactNode } from 'react';
import { GitCompareArrows, GitPullRequestArrow } from 'lucide-react';
import { prScope } from '../../../shared/prScope';
import type { PrRef, Task } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { useProjects } from '../../stores/projectsStore';
import { useUi } from '../../stores/uiStore';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import { DockedPanel } from '../ui/DockedPanel';
import { EmptyState } from '../ui/EmptyState';
import { finishOffered, unsentNoteCount } from './finishReview';
import { FinishReviewSheet } from './FinishReviewSheet';
import { communicationCounts } from './labels';
import { NotesTray } from './NotesTray';
import { communicationTally, fileRows, replyDraftCounts, reviewComments } from './outline';
import { ReviewChanges } from './ReviewChanges';
import { ReviewHeader } from './ReviewHeader';
import { ReviewOverview } from './ReviewOverview';
import { ReviewThreads } from './ReviewThreads';
import { useReviewData } from './useReviewData';
import { YourReview } from './YourReview';

/** Review mode's views, each scoped to the PR. */
export type ReviewTab = 'overview' | 'changes' | 'files' | 'history';

interface ReviewViewProps {
  task: Task;
  /** The PR the task is in review mode for. */
  mode: PrRef;
  tab: ReviewTab;
  /** Files' and History's lists, scoped to the PR by the host. */
  files: ReactNode;
  history: ReactNode;
  /** The file showing in the focused editor group. */
  activePath: string | null;
  /** Open a file of the PR in its view, expanding the sidebar. */
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  /** The editor shows one group (a file's menu offers "Open in new pane"). */
  canOpenToSide: boolean;
  /** Show the PR's commits (History). */
  onShowCommits: () => void;
  /** How the task's checkout differs from the PR, when it does (the diff
   *  then shows the PR's head read-only). */
  notice: string | null;
  /** Show a draft or note where it was written. */
  onNavigate: (scope: string, path: string, commentId: string) => void;
  /** Leave review mode. */
  onExit: () => void;
}

/**
 * The task sidebar's list column in review mode (spec Revision 3): the PR's
 * header and its actions, then the picked view (Overview, the PR's Changes,
 * Files at its head, its History), then the Communication bar docked at the
 * bottom (threads, the person's drafts, the notes to the agent). Narrow it is
 * the whole column; expanded, the list column beside the editor's PR view.
 */
export function ReviewView(props: ReviewViewProps) {
  return <Review key={`${props.mode.provider}:${props.mode.number}`} {...props} />;
}

function Review({
  task,
  mode,
  tab,
  files,
  history,
  activePath,
  onOpenFile,
  canOpenToSide,
  onShowCommits,
  notice,
  onNavigate,
  onExit,
}: ReviewViewProps) {
  const { review, marks, error, loading, refresh } = useReviewData({
    taskId: task.id,
    projectId: task.projectId,
    cwd: task.path,
    target: mode,
  });
  const remote = useProjects(
    (s) => s.projects.find((p) => p.id === task.projectId)?.gitRemote ?? null,
  );
  const commsOpen = useUi((s) => s.reviewCommsOpen);
  const [finishing, setFinishing] = useState(false);
  const scope = prScope(mode.provider, mode.number);
  const commentsReady = useCommentsStore((s) => s.taskId === task.id && !s.disabled);
  const byFile = useCommentsStore((s) => s.byFile);
  const comments = useMemo(() => reviewComments(byFile, scope), [byFile, scope]);
  const rows = useMemo(
    () => (review ? fileRows(review.files, review.threads, marks, comments) : []),
    [review, marks, comments],
  );
  const replyDrafts = useMemo(() => replyDraftCounts(comments), [comments]);
  const { summary } = useTaskReview(task.id, mode);

  if (!review) {
    return error ? (
      <EmptyState
        icon={<GitPullRequestArrow size={14} strokeWidth={1.8} />}
        title={`Could not load PR #${mode.number}`}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-gutter-stable scrollbar-thin-hover flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ReviewHeader
          review={review}
          remote={remote}
          loading={loading}
          error={error}
          onRefresh={refresh}
          onShowCommits={onShowCommits}
          onFinish={canFinish ? () => setFinishing(true) : undefined}
          onExit={onExit}
        />
        {notice && (
          <p
            className="type-caption mx-2.5 my-1 flex items-start gap-2 rounded-lg border border-line bg-well px-2.5 py-1.5"
            role="status"
          >
            <GitCompareArrows size={14} strokeWidth={1.8} className="shrink-0" />
            <span className="min-w-0 flex-1 tabular-nums">{notice}</span>
          </p>
        )}
        <div className="min-h-0 flex-1">
          {tab === 'overview' ? (
            <ReviewOverview review={review} remote={remote} />
          ) : tab === 'changes' ? (
            <ReviewChanges
              review={review}
              rows={rows}
              cwd={task.path}
              activePath={activePath}
              canOpenToSide={canOpenToSide}
              onOpenFile={onOpenFile}
            />
          ) : tab === 'files' ? (
            files
          ) : (
            history
          )}
        </div>
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
