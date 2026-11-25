import { useCallback, useMemo } from 'react';
import type { DiffCommentKind, PrReview, PrReviewThread } from '../../../../shared/types';
import { useCommentsStore } from '../../../stores/commentsStore';
import { prKey, usePrReviews } from '../../../stores/prReviewStore';
import type { EditorView } from '../types';
import { composerKind, isInlineThread } from './prViewPolicy';
import { usePrThreadContext, type PrThreadContext } from './usePrThreadContext';

export interface PrView {
  /** The PR's review as last fetched; null outside a PR view, or until loaded. */
  review: PrReview | null;
  /** What a new one written in the view is. */
  newKind: DiffCommentKind;
  /** Pick what new ones are; kept for the PR for the session. Null outside a
   *  PR view, where everything is a note. */
  setNewKind: ((kind: DiffCommentKind) => void) | null;
  /** The PR's draft scope, or null without a review or a task to own drafts. */
  draftScope: string | null;
  /** The open file's threads on the PR's side, once the file has loaded. */
  inlineThreads: PrReviewThread[];
  /** A note can be promoted to a PR comment here. */
  canPromote: boolean;
  /** What the thread cards under the lines work with; null until the review loads. */
  threadContext: PrThreadContext | null;
}

/**
 * The PR view's wiring for the editor: its review and threads, and the
 * policy for what's written in it. Outside a PR view
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
}: {
  view: EditorView;
  /** The view's comment scope. */
  scope: string;
  activeTaskId: string | null;
  projectId: string | null;
  cwd: string;
  filePath: string;
  isFileLoaded: boolean;
}): PrView {
  const isPrView = view.kind === 'pr';
  const commentsDisabled = useCommentsStore((s) => s.disabled);
  const key = view.kind === 'pr' ? prKey(view.provider, view.number) : null;
  const review = usePrReviews((s) => (key ? (s.byPr[key] ?? null) : null));
  const picked = usePrReviews((s) => (key ? s.kindPicks[key] : undefined));

  const inlineThreads = useMemo(
    () =>
      review && isFileLoaded
        ? review.threads.filter((t) => t.path === filePath && isInlineThread(t))
        : [],
    [review, filePath, isFileLoaded],
  );

  // PR drafts need a task to own them.
  const draftScope = review && !commentsDisabled ? scope : null;
  const threadContext = usePrThreadContext({
    review,
    projectId,
    cwd,
    taskId: activeTaskId,
    draftScope,
  });
  const setNewKind = useCallback(
    (kind: DiffCommentKind) => {
      if (view.kind === 'pr') usePrReviews.getState().pickKind(view.provider, view.number, kind);
    },
    [view],
  );

  return {
    review,
    // Until the review loads, whose PR it is is unknown: a note is the safe start.
    newKind: composerKind({
      isPrView,
      viewerIsAuthor: review?.viewerIsAuthor ?? true,
      picked,
    }),
    setNewKind: isPrView ? setNewKind : null,
    draftScope,
    inlineThreads,
    canPromote: isPrView && !commentsDisabled,
    threadContext,
  };
}
