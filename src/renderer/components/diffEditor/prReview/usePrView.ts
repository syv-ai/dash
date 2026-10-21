import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type {
  DiffComment,
  DiffCommentKind,
  PrReview,
  PrReviewThread,
} from '../../../../shared/types';
import { useCommentsStore } from '../../../stores/commentsStore';
import { prKey, usePrReviews } from '../../../stores/prReviewStore';
import { buildReviewPrompt } from '../../../utils/prReviewNotices';
import { typeIntoTask } from '../../../utils/typeIntoTask';
import { filterCommentsByScope } from '../comments/commentScope';
import type { EditorView } from '../types';
import { isInlineThread, newCommentKind } from './prViewPolicy';
import { useTaskReview } from './useTaskReview';

export interface PrView {
  /** The PR's review as last fetched; null outside a PR view, or until loaded. */
  review: PrReview | null;
  /** The task is reviewing the PR. */
  inReview: boolean;
  toggleReview: () => void;
  /** What a new one written in the view is. */
  newKind: DiffCommentKind;
  /** The PR's draft scope, or null without a review or a task to own drafts. */
  draftScope: string | null;
  /** The open file's threads on the PR's side, once the file has loaded. */
  inlineThreads: PrReviewThread[];
  /** What the bulk sends take in a PR view: its notes and comments. Null
   *  outside one. */
  sendable: Record<string, DiffComment[]> | null;
  /** A note can be promoted to a PR comment here. */
  canPromote: boolean;
  setThreadResolved: (thread: PrReviewThread, resolved: boolean) => void;
  /** Type threads into the task; `close` closes the editor once they're in. */
  sendThreads: (threads: PrReviewThread[], close: boolean) => void;
}

/**
 * The PR view's wiring for the editor: its review and threads, the task's
 * review state, and the policy for what's written in it. Outside a PR view
 * it's inert: no review, notes only.
 */
export function usePrView({
  view,
  scope,
  activeTaskId,
  projectId,
  cwd,
  filePath,
  isFileLoaded,
  onClose,
}: {
  view: EditorView;
  /** The view's comment scope. */
  scope: string;
  activeTaskId: string | null;
  projectId: string | null;
  cwd: string;
  filePath: string;
  isFileLoaded: boolean;
  onClose: () => void;
}): PrView {
  const isPrView = view.kind === 'pr';
  const commentsDisabled = useCommentsStore((s) => s.disabled);
  const commentsByFile = useCommentsStore((s) => s.byFile);
  const { inReview, setInReview } = useTaskReview(activeTaskId, isPrView ? view : null);
  const review = usePrReviews((s) =>
    view.kind === 'pr' ? (s.byPr[prKey(view.provider, view.number)] ?? null) : null,
  );

  const inlineThreads = useMemo(
    () =>
      review && isFileLoaded
        ? review.threads.filter((t) => t.path === filePath && isInlineThread(t))
        : [],
    [review, filePath, isFileLoaded],
  );
  const sendable = useMemo(
    () => (isPrView ? filterCommentsByScope(commentsByFile, scope) : null),
    [isPrView, commentsByFile, scope],
  );

  const setThreadResolved = useCallback(
    async (thread: PrReviewThread, resolved: boolean) => {
      if (!review || !projectId) return;
      const r = await usePrReviews
        .getState()
        .setResolved(projectId, cwd, review, thread.id, resolved);
      if (!r.ok) {
        const why = r.error.kind === 'other' ? r.error.message : 'the PR refused the change';
        toast.error(`Could not ${resolved ? 'resolve' : 'reactivate'} the thread: ${why}`);
      }
    },
    [review, projectId, cwd],
  );
  const sendThreads = useCallback(
    async (threads: PrReviewThread[], close: boolean) => {
      if (!activeTaskId || !review || threads.length === 0) return;
      if ((await typeIntoTask(activeTaskId, buildReviewPrompt(review, threads))) && close) {
        onClose();
      }
    },
    [activeTaskId, review, onClose],
  );

  return {
    review,
    inReview,
    toggleReview: () => setInReview(!inReview),
    newKind: newCommentKind(isPrView, inReview),
    // PR drafts need a task to own them.
    draftScope: review && !commentsDisabled ? scope : null,
    inlineThreads,
    sendable,
    canPromote: isPrView && !commentsDisabled,
    setThreadResolved: (t, r) => void setThreadResolved(t, r),
    sendThreads: (t, close) => void sendThreads(t, close),
  };
}
