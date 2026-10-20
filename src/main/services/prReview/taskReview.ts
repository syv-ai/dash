import type {
  DiffComment,
  PrProvider,
  PrReviewSummary,
  PrVerdict,
  SubmitResult,
} from '@shared/types';
import { isPrScope, prScope } from '@shared/prScope';
import { diffCommentsRepo, type AgentDraft, type DiffCommentsRepo } from '../diffCommentsRepo';
import { prReviewsInProgressRepo, type PrReviewsInProgressRepo } from '../prReviewsInProgressRepo';
import { emitDiffCommentsChanged } from '../diffCommentEvents';
import type { PrContext, PrReviewProvider } from './types';

/** Which PR: its provider and number. */
export interface PrRef {
  provider: PrProvider;
  number: number;
}

/** Where a submit goes: the PR's adapter and the context to call it with. */
export interface SubmitTarget {
  adapter: Pick<PrReviewProvider, 'submit'>;
  ctx: PrContext;
}

/**
 * A task's review of a PR: its notes and draft comments, whether the task is
 * reviewing it, its draft summary, and Submit. The IPC handlers and the
 * control API's review capabilities both go through here. A write made outside
 * the editor (an agent's, or a submit's) tells the editor; its own writes don't,
 * because its store already holds them.
 */
export interface TaskReviews {
  /** The task's notes and comments on the PR. */
  drafts(taskId: string, pr: PrRef): DiffComment[];
  /** One of the task's notes or comments on any PR, or undefined. */
  draft(taskId: string, id: string): DiffComment | undefined;
  saveAgentDraft(draft: AgentDraft): DiffComment;
  deleteAgentDraft(taskId: string, id: string): void;
  isInReview(taskId: string, pr: PrRef): boolean;
  /** Start (Review) or end the task's review of the PR. */
  setInReview(taskId: string, pr: PrRef, on: boolean): void;
  getSummary(taskId: string, pr: PrRef): PrReviewSummary | null;
  /** Replace the draft summary; an empty body clears it. */
  setSummary(taskId: string, pr: PrRef, summary: PrReviewSummary): void;
  /**
   * Post the task's comments on the PR (not its notes) with a verdict and
   * summary. Drafts that reached the PR are deleted. A submit with no error
   * ends the review and clears the summary, so what's written next is a note
   * again. A write the provider refused comes back as the result's error.
   */
  submit(
    taskId: string,
    pr: PrRef,
    target: SubmitTarget,
    verdict: PrVerdict,
    body: string,
  ): Promise<SubmitResult>;
}

export interface TaskReviewDeps {
  comments: DiffCommentsRepo;
  reviews: PrReviewsInProgressRepo;
  /** Tell an open diff editor the task's review drafts changed. */
  changed(taskId: string): void;
}

export function createTaskReviews({ comments, reviews, changed }: TaskReviewDeps): TaskReviews {
  const setSummary = (taskId: string, pr: PrRef, summary: PrReviewSummary) =>
    reviews.setSummary(taskId, pr.provider, pr.number, summary);
  return {
    drafts: (taskId, pr) => comments.listByScope(taskId, prScope(pr.provider, pr.number)),
    draft(taskId, id) {
      const c = comments.get(id);
      return c && c.taskId === taskId && isPrScope(c.viewScope) ? c : undefined;
    },
    saveAgentDraft(draft) {
      const saved = comments.upsertFromAgent(draft);
      changed(draft.taskId);
      return saved;
    },
    deleteAgentDraft(taskId, id) {
      comments.delete(id);
      changed(taskId);
    },
    isInReview: (taskId, pr) => reviews.isInReview(taskId, pr.provider, pr.number),
    setInReview: (taskId, pr, on) => reviews.setInReview(taskId, pr.provider, pr.number, on),
    getSummary: (taskId, pr) => reviews.getSummary(taskId, pr.provider, pr.number),
    setSummary(taskId, pr, summary) {
      setSummary(taskId, pr, summary);
      if (summary.author === 'agent') changed(taskId);
    },
    async submit(taskId, pr, { adapter, ctx }, verdict, body) {
      const drafts = comments.listPrDrafts(taskId, pr.provider, pr.number);
      const result = await adapter.submit(ctx, pr.number, {
        verdict,
        body,
        comments: drafts.comments.map((c) => ({
          draftId: c.id,
          path: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          body: c.text,
        })),
        replies: drafts.replies.map((c) => ({
          draftId: c.id,
          threadId: c.replyTo!,
          body: c.text,
        })),
      });
      if (result.postedDraftIds.length > 0) {
        comments.deleteByIds(result.postedDraftIds);
        changed(taskId);
      }
      if (!result.error) {
        reviews.setInReview(taskId, pr.provider, pr.number, false);
        setSummary(taskId, pr, { body: '', author: 'user' });
      }
      return result;
    },
  };
}

let instance: TaskReviews | null = null;

/** The app's task reviews, over its database. */
export function taskReviews(): TaskReviews {
  instance ??= createTaskReviews({
    comments: diffCommentsRepo(),
    reviews: prReviewsInProgressRepo(),
    changed: emitDiffCommentsChanged,
  });
  return instance;
}
