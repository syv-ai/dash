import type {
  DiffComment,
  PrProvider,
  PrReviewSummary,
  PrVerdict,
  SubmitResult,
} from '@shared/types';
import { prScope } from '@shared/prScope';
import { isMoved, isPrDraft } from '@shared/diffComments';
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
  adapter: Pick<PrReviewProvider, 'submit' | 'head'>;
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
  /** The task's notes and comments on every PR. */
  allDrafts(taskId: string): DiffComment[];
  /** One of the task's notes or comments on any PR, or undefined. */
  draft(taskId: string, id: string): DiffComment | undefined;
  saveAgentDraft(draft: AgentDraft): DiffComment;
  deleteAgentDrafts(taskId: string, ids: readonly string[]): void;
  isInReview(taskId: string, pr: PrRef): boolean;
  /** Start (Review) or end the task's review of the PR. */
  setInReview(taskId: string, pr: PrRef, on: boolean): void;
  getSummary(taskId: string, pr: PrRef): PrReviewSummary | null;
  /** Replace the draft summary; an empty body clears it. With `ifUnchangedSince`,
   *  only if it's still that version (see PrReviewsInProgressRepo.setSummary). */
  setSummary(taskId: string, pr: PrRef, summary: PrReviewSummary, ifUnchangedSince?: string): void;
  /**
   * Post the task's comments on the PR (not its notes) with a verdict and
   * summary. Drafts that reached the PR are deleted. A line comment written on
   * an older head of the PR is held back, not posted on code it wasn't about.
   * A submit with no error ends the review and clears the summary, so what's
   * written next is a note again; one that held drafts back keeps the review
   * going, for them. A write the provider refused comes back as the result's error.
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
  const setSummary = (
    taskId: string,
    pr: PrRef,
    summary: PrReviewSummary,
    ifUnchangedSince?: string,
  ) => reviews.setSummary(taskId, pr.provider, pr.number, summary, ifUnchangedSince);
  return {
    drafts: (taskId, pr) => comments.listByScope(taskId, prScope(pr.provider, pr.number)),
    allDrafts: (taskId) => comments.listByTask(taskId).filter(isPrDraft),
    draft(taskId, id) {
      const c = comments.get(id);
      return c && c.taskId === taskId && isPrDraft(c) ? c : undefined;
    },
    saveAgentDraft(draft) {
      const saved = comments.upsertFromAgent(draft);
      changed(draft.taskId);
      return saved;
    },
    deleteAgentDrafts(taskId, ids) {
      if (ids.length === 0) return;
      comments.deleteByIds(ids);
      changed(taskId);
    },
    isInReview: (taskId, pr) => reviews.isInReview(taskId, pr.provider, pr.number),
    setInReview: (taskId, pr, on) => reviews.setInReview(taskId, pr.provider, pr.number, on),
    getSummary: (taskId, pr) => reviews.getSummary(taskId, pr.provider, pr.number),
    setSummary(taskId, pr, summary, ifUnchangedSince) {
      setSummary(taskId, pr, summary, ifUnchangedSince);
      if (summary.author === 'agent') changed(taskId);
    },
    async submit(taskId, pr, { adapter, ctx }, verdict, body) {
      const drafts = comments.listPrDrafts(taskId, pr.provider, pr.number);
      let head = '';
      if (drafts.comments.some((c) => c.commit)) {
        try {
          head = await adapter.head(ctx, pr.number);
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          const message = `Couldn't check whether the PR changed since the comments were written, so nothing was posted: ${why}`;
          return { postedDraftIds: [], error: { kind: 'other', message } };
        }
      }
      const heldBack = drafts.comments.filter((c) => isMoved(c, head));
      const toPost = drafts.comments.filter((c) => !isMoved(c, head));
      const heldBackDraftIds = heldBack.map((c) => c.id);
      // Everything held back and nothing else to say: there's no review to post.
      if (
        heldBack.length > 0 &&
        toPost.length === 0 &&
        drafts.replies.length === 0 &&
        !body.trim() &&
        verdict === 'comment'
      ) {
        return { postedDraftIds: [], heldBackDraftIds };
      }
      const result = await adapter.submit(ctx, pr.number, {
        verdict,
        body,
        comments: toPost.map((c) => ({
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
        if (heldBack.length === 0) reviews.setInReview(taskId, pr.provider, pr.number, false);
        setSummary(taskId, pr, { body: '', author: 'user' });
      }
      return heldBack.length > 0 ? { ...result, heldBackDraftIds } : result;
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
