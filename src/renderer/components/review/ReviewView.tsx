import { useMemo } from 'react';
import { GitPullRequestArrow } from 'lucide-react';
import { prScope } from '../../../shared/prScope';
import { isPrComment } from '../../../shared/diffComments';
import type { PrRef, Task } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { usePrReviews } from '../../stores/prReviewStore';
import { EmptyState } from '../ui/EmptyState';
import { fileRows, replyDraftCounts, reviewComments, viewedBlob } from './outline';
import { NotesTray } from './NotesTray';
import { ReviewFiles } from './ReviewFiles';
import { ReviewHeader } from './ReviewHeader';
import { ReviewProgress } from './ReviewProgress';
import { ReviewThreads } from './ReviewThreads';
import { useReviewData } from './useReviewData';
import { YourReview } from './YourReview';

interface ReviewViewProps {
  task: Task;
  /** The task's review target; undefined while it loads. */
  target: PrRef | null | undefined;
  /** "Stop reviewing" applies: the target was picked for the task (not its own PR). */
  canStop: boolean;
  /** The file showing in the focused editor group. */
  activePath: string | null;
  /** Open a file of the PR in the PR view, expanding the sidebar. */
  onOpenFile: (path: string) => void;
  /** Open the PR's overview tab, expanding the sidebar. */
  onOpenOverview: (pr: PrRef) => void;
  /** Show a draft or note where it was written. */
  onNavigate: (scope: string, path: string, commentId: string) => void;
}

/**
 * The task sidebar's Review view: the outline of the PR the task reviews —
 * header, reading progress, files, threads, the person's review, and the notes
 * to the agent. Empty blocks hide. Narrow it is the whole column; expanded,
 * the list column beside the editor's PR view.
 */
export function ReviewView({ target, ...rest }: ReviewViewProps) {
  if (!target) return <EmptyState title="Loading…" />;
  return <Outline key={`${target.provider}:${target.number}`} target={target} {...rest} />;
}

function Outline({
  task,
  target,
  canStop,
  activePath,
  onOpenFile,
  onOpenOverview,
  onNavigate,
}: Omit<ReviewViewProps, 'target'> & { target: PrRef }) {
  const { review, marks, error, loading, refresh } = useReviewData({
    taskId: task.id,
    projectId: task.projectId,
    cwd: task.path,
    target,
  });
  const scope = prScope(target.provider, target.number);
  const commentsReady = useCommentsStore((s) => s.taskId === task.id && !s.disabled);
  const byFile = useCommentsStore((s) => s.byFile);
  const { comments, noteCount } = useMemo(() => {
    const comments = reviewComments(byFile, scope);
    const noteCount = Object.values(byFile)
      .flat()
      .filter((c) => c.viewScope === scope && !isPrComment(c)).length;
    return { comments, noteCount };
  }, [byFile, scope]);
  const rows = useMemo(
    () => (review ? fileRows(review.files, review.threads, marks, comments) : []),
    [review, marks, comments],
  );
  const replyDrafts = useMemo(() => replyDraftCounts(comments), [comments]);

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

  return (
    <div className="scrollbar-gutter-stable scrollbar-thin-hover flex h-full min-h-0 flex-col overflow-y-auto pb-2">
      <ReviewHeader
        review={review}
        loading={loading}
        onRefresh={refresh}
        onOpenOverview={() => onOpenOverview(target)}
        onStop={canStop ? () => usePrReviews.getState().setTarget(task.id, null) : undefined}
      />
      <ReviewProgress rows={rows} activePath={activePath} onOpenFile={onOpenFile} />
      <ReviewFiles
        rows={rows}
        activePath={activePath}
        onOpenFile={onOpenFile}
        onSetViewed={(row, viewed) =>
          usePrReviews
            .getState()
            .setViewed(
              task.id,
              target.provider,
              target.number,
              row.file.path,
              viewed ? viewedBlob(row.file) : null,
            )
        }
      />
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
          noteCount={noteCount}
          onNavigate={onNavigate}
        />
      )}
      <NotesTray taskId={task.id} onNavigate={onNavigate} />
    </div>
  );
}
