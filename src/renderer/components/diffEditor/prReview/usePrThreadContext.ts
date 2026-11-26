import { useMemo } from 'react';
import { toast } from '../../ui/toast';
import type {
  PrReactionContent,
  PrReview,
  PrReviewComment,
  PrReviewThread,
  PrWriteError,
} from '../../../../shared/types';
import { usePrReviews, type ReplyPoster } from '../../../stores/prReviewStore';
import { buildReviewPrompt } from '../../../utils/agentPrompt';
import { typeIntoTask } from '../../../utils/typeIntoTask';
import { mentionCandidates } from '../comments/mentions';

/** What a thread card works with, wherever it is drawn (under its line in
 *  the editor, or in the Comments tab): the PR, who owns drafts, and the
 *  writes a card can make. */
export interface PrThreadContext {
  review: PrReview;
  /** The PR's draft scope; null without a task to own drafts. */
  draftScope: string | null;
  /** Why a thread can't take a draft reply now (no draft scope); null when it can. */
  replyBlocked: string | null;
  /** On the own PR: where draft replies post from (Post reply / Post & resolve). */
  replyPoster: ReplyPoster | null;
  /** Who `@` completes from in a reply. */
  mentions: string[];
  setResolved: (thread: PrReviewThread, resolved: boolean) => void;
  /** Type the thread into the task's prompt ("Ask agent"). */
  ask: (thread: PrReviewThread) => void;
  /** Reply to a general comment (the PR's conversation): posts at once, on
   *  the person's Post reply (D225). Answers whether it posted; a refusal toasts. */
  replyGeneral: (comment: PrReviewComment, text: string) => Promise<boolean>;
  /** Give or take back the viewer's reaction: posts at once (D194). */
  react: (comment: PrReviewComment, content: PrReactionContent, on: boolean) => void;
}

const why = (e: PrWriteError, fallback: string): string =>
  e.kind === 'other' ? e.message : e.kind === 'scope' ? `the token can't (${e.fix})` : fallback;

/**
 * The thread cards' context for a PR: null until its review has loaded or
 * without a project. A failed write is undone in the store and toasts here,
 * once for both places a card is drawn.
 */
export function usePrThreadContext({
  review,
  projectId,
  cwd,
  taskId,
  draftScope,
}: {
  review: PrReview | null;
  projectId: string | null;
  cwd: string;
  taskId: string | null;
  draftScope: string | null;
}): PrThreadContext | null {
  return useMemo(() => {
    if (!review || !projectId) return null;
    const store = usePrReviews.getState;
    return {
      review,
      draftScope,
      replyBlocked: draftScope
        ? null
        : taskId
          ? "The task's drafts are still loading"
          : 'Replies are drafted in a task; open this PR from one',
      replyPoster:
        review.viewerIsAuthor && draftScope && taskId ? { projectId, cwd, taskId, review } : null,
      mentions: mentionCandidates(review),
      setResolved: (thread, resolved) =>
        void store()
          .setResolved(projectId, cwd, review, thread.id, resolved)
          .then((r) => {
            if (!r.ok)
              toast.error(
                `Could not ${resolved ? 'resolve' : 'reactivate'} the thread: ${why(r.error, 'the PR refused the change')}`,
              );
          }),
      ask: (thread) => {
        if (taskId) void typeIntoTask(taskId, buildReviewPrompt(review, [thread]));
      },
      replyGeneral: async (comment, text) => {
        const r = await store().replyGeneral(projectId, cwd, review, comment, text);
        if (r.ok) toast.success('Reply posted');
        else toast.error(`Could not post the reply: ${why(r.error, 'the PR refused it')}`);
        return r.ok;
      },
      react: (comment, content, on) =>
        void store()
          .react(projectId, cwd, review, comment.id, content, on)
          .then((r) => {
            if (!r.ok)
              toast.error(
                `Could not ${on ? 'add' : 'remove'} the reaction: ${why(r.error, 'the PR refused it')}`,
              );
          }),
    };
  }, [review, projectId, cwd, taskId, draftScope]);
}
