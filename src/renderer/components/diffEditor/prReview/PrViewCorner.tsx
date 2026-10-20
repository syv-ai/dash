import { unresolvedThreads } from '../../../utils/prReviewNotices';
import { PrReviewMenu } from './PrReviewMenu';
import { ReviewButton } from './ReviewButton';
import type { PrView } from './usePrView';

interface Props {
  pr: PrView;
  activeTaskId: string | null;
  projectId: string | null;
  cwd: string;
  currentFilePath: string;
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (scope: string, filePath: string, commentId: string) => void;
  onSendOne: (commentId: string) => void;
  onSendMany: (commentIds: ReadonlyArray<string>) => void;
  onSelectFile: (path: string) => void;
}

/** The PR view's bottom-right corner: Review (with a task to own the drafts)
 *  and the PR's review menu. Nothing until the review has loaded. */
export function PrViewCorner({
  pr,
  activeTaskId,
  projectId,
  cwd,
  currentFilePath,
  getLiveRangeForCurrent,
  onNavigate,
  onSendOne,
  onSendMany,
  onSelectFile,
}: Props) {
  const { review, draftScope, inReview } = pr;
  if (!review) return null;
  return (
    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
      {draftScope && activeTaskId && (
        <ReviewButton
          inReview={inReview}
          asked={review.viewerIsRequestedReviewer}
          onToggle={pr.toggleReview}
        />
      )}
      <PrReviewMenu
        review={review}
        draftScope={draftScope}
        inReview={inReview}
        currentFilePath={currentFilePath}
        getLiveRangeForCurrent={getLiveRangeForCurrent}
        onNavigate={onNavigate}
        onSendOne={onSendOne}
        onSendMany={onSendMany}
        submitCtx={
          draftScope && projectId && activeTaskId ? { projectId, cwd, taskId: activeTaskId } : null
        }
        onSetResolved={pr.setThreadResolved}
        onSendAll={() => pr.sendThreads(unresolvedThreads(review), true)}
        onSend={(t) => pr.sendThreads([t], false)}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}
