import { useMemo, useState, type ReactNode } from 'react';
import { GitCompareArrows, GitPullRequestArrow } from 'lucide-react';
import { prScope } from '../../../shared/prScope';
import type { PrRef, Task } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { useProjects } from '../../stores/projectsStore';
import { useUi } from '../../stores/uiStore';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { CodeSegment } from '../rightInspector/sidebarState';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { finishOffered, unsentNoteCount } from './finishReview';
import { FinishReviewSheet } from './FinishReviewSheet';
import { CommentsTab } from './CommentsTab';
import { NotesTray } from './NotesTray';
import { fileRows, reviewComments } from './outline';
import { ReviewFiles, type RepoFiles } from './ReviewFiles';
import { ReviewHeader } from './ReviewHeader';
import { ReviewOverview } from './ReviewOverview';
import { useReviewData } from './useReviewData';

interface ReviewViewProps {
  task: Task;
  /** The PR the task is in review mode for. */
  mode: PrRef;
  /** The sidebar's view, each scoped to the PR. */
  tab: CodeSegment;
  /** Every file at the PR's head (Files' "All files"). */
  repo: RepoFiles;
  /** History's list, scoped to the PR by the host. */
  history: ReactNode;
  /** The Comments | Notes switch's counts, as the view switch shows them. */
  tally: { comments: number; notes: number } | null;
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
 * The task sidebar's list column in review mode (spec Revision 4), under the
 * mode's banner and views: the PR's header, then the picked view: Overview,
 * Files (the PR's changed files, or all at its head), Comments (a switch
 * between every exchange with the author, the person's drafts among them,
 * and the notes to the agent) or History; Finish review… is the column's
 * sticky footer on every view, the one way to it.
 * Narrow it is the whole column; expanded, the list column beside the
 * editor's PR view.
 */
export function ReviewView(props: ReviewViewProps) {
  return <Review key={`${props.mode.provider}:${props.mode.number}`} {...props} />;
}

function Review({
  task,
  mode,
  tab,
  repo,
  history,
  tally,
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
  const pane = useUi((s) => s.reviewCommentsPane);
  const [finishing, setFinishing] = useState(false);
  const scope = prScope(mode.provider, mode.number);
  const commentsReady = useCommentsStore((s) => s.taskId === task.id && !s.disabled);
  const byFile = useCommentsStore((s) => s.byFile);
  const comments = useMemo(() => reviewComments(byFile, scope), [byFile, scope]);
  const rows = useMemo(
    () => (review ? fileRows(review.files, review.threads, marks, comments) : []),
    [review, marks, comments],
  );
  const { summary } = useTaskReview(task.id, mode);

  if (!review) {
    return error ? (
      <EmptyState
        icon={<GitPullRequestArrow size={14} strokeWidth={1.8} />}
        title={`Could not load PR #${mode.number}`}
        description={error}
        action={
          <Button size="sm" onClick={onExit}>
            Exit review
          </Button>
        }
      />
    ) : (
      <EmptyState title="Loading…" />
    );
  }

  const canFinish =
    commentsReady &&
    finishOffered({ own: review.viewerIsAuthor, comments, summary: summary?.body ?? '' });
  const onFinish = canFinish ? () => setFinishing(true) : undefined;

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
        />
        {notice && (
          <Notice icon={<GitCompareArrows size={14} strokeWidth={1.8} />} className="mx-2.5 my-1">
            {notice}
          </Notice>
        )}
        <div className="min-h-0 flex-1">
          {tab === 'overview' ? (
            <ReviewOverview review={review} remote={remote} />
          ) : tab === 'files' ? (
            <ReviewFiles
              review={review}
              rows={rows}
              repo={repo}
              cwd={task.path}
              activePath={activePath}
              canOpenToSide={canOpenToSide}
              onOpenFile={onOpenFile}
            />
          ) : tab === 'comments' ? (
            <div className="pt-2">
              <div className="px-2.5 pb-2">
                <Segmented
                  aria-label="Comments or notes"
                  size="sm"
                  fullWidth={false}
                  value={pane}
                  onChange={(p) => useUi.getState().setReviewCommentsPane(p)}
                  options={[
                    {
                      value: 'comments',
                      label: 'Comments',
                      count: tally?.comments || undefined,
                      countLabel: 'Unresolved',
                    },
                    {
                      value: 'notes',
                      label: 'Notes',
                      count: tally?.notes || undefined,
                      countLabel: 'Unsent',
                    },
                  ]}
                />
              </div>
              {pane === 'comments' ? (
                <CommentsTab
                  review={review}
                  taskId={task.id}
                  projectId={task.projectId}
                  cwd={task.path}
                  draftScope={commentsReady ? scope : null}
                  comments={commentsReady ? comments : []}
                  summary={summary?.body.trim() ?? ''}
                  onNavigate={onNavigate}
                />
              ) : (
                <NotesTray taskId={task.id} onNavigate={onNavigate} />
              )}
            </div>
          ) : (
            history
          )}
        </div>
      </div>
      {/* The one way to Finish review…, on every view, in reach however far
          the column scrolls. */}
      {onFinish && (
        <div className="grid shrink-0 border-t border-line px-2.5 py-2">
          <Button size="sm" variant="primary" onClick={onFinish}>
            Finish review…
          </Button>
        </div>
      )}
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
