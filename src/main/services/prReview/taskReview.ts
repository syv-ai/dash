import type {
  DiffComment,
  PrRef,
  PrReviewComment,
  PrReviewSummary,
  PrVerdict,
  SubmitResult,
} from '@shared/types';
import { prScope } from '@shared/prScope';
import { isPrDraft } from '@shared/diffComments';
import { diffCommentsRepo, type AgentDraft, type DiffCommentsRepo } from '../diffCommentsRepo';
import { prReviewSummariesRepo, type PrReviewSummariesRepo } from '../prReviewSummariesRepo';
import { emitDiffCommentsChanged } from '../diffCommentEvents';
import type { PrContext, PrReviewProvider } from './types';

/** Where a write goes: the PR's adapter and the context to call it with. */
export interface WriteTarget<K extends 'submit' | 'reply'> {
  adapter: Pick<PrReviewProvider, K>;
  ctx: PrContext;
}
export type SubmitTarget = WriteTarget<'submit'>;
export type ReplyTarget = WriteTarget<'reply'>;

/**
 * A task's review of a PR: its notes and draft comments, its draft summary,
 * Submit, and a reply posted on its own. The IPC handlers and the
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
  getSummary(taskId: string, pr: PrRef): PrReviewSummary | null;
  /** Replace the draft summary; an empty body clears it. */
  setSummary(taskId: string, pr: PrRef, summary: PrReviewSummary): void;
  /**
   * Post the task's comments on the PR (not its notes) with a verdict and
   * summary. Drafts that reached the PR are deleted. A submit with no error
   * clears the summary. A write the provider refused comes back as the
   * result's error.
   */
  submit(
    taskId: string,
    pr: PrRef,
    target: SubmitTarget,
    verdict: PrVerdict,
    body: string,
  ): Promise<SubmitResult>;
  /**
   * Post `body` as a reply to thread `threadId` at once, outside any review,
   * and delete the draft it came from (if any). Throws when the PR refuses.
   */
  reply(
    taskId: string,
    pr: PrRef,
    target: ReplyTarget,
    reply: { threadId: string; body: string; draftId?: string },
  ): Promise<PrReviewComment>;
}

export interface TaskReviewDeps {
  comments: DiffCommentsRepo;
  summaries: PrReviewSummariesRepo;
  /** Tell an open diff editor the task's review drafts changed. */
  changed(taskId: string): void;
}

export function createTaskReviews({ comments, summaries, changed }: TaskReviewDeps): TaskReviews {
  const setSummary = (taskId: string, pr: PrRef, summary: PrReviewSummary) =>
    summaries.setSummary(taskId, pr.provider, pr.number, summary);
  return {
    drafts: (taskId, pr) => comments.listByScope(taskId, prScope(pr.provider, pr.number)),
    draft(taskId, id) {
      const c = comments.get(id);
      return c && c.taskId === taskId && isPrDraft(c) ? c : undefined;
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
    getSummary: (taskId, pr) => summaries.getSummary(taskId, pr.provider, pr.number),
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
      if (!result.error) setSummary(taskId, pr, { body: '', author: 'user' });
      return result;
    },
    async reply(taskId, pr, { adapter, ctx }, { threadId, body, draftId }) {
      const posted = await adapter.reply(ctx, pr.number, threadId, body);
      const draft = draftId ? comments.get(draftId) : undefined;
      if (draft && draft.taskId === taskId) comments.delete(draft.id);
      changed(taskId);
      return posted;
    },
  };
}

let instance: TaskReviews | null = null;

/** The app's task reviews, over its database. */
export function taskReviews(): TaskReviews {
  instance ??= createTaskReviews({
    comments: diffCommentsRepo(),
    summaries: prReviewSummariesRepo(),
    changed: emitDiffCommentsChanged,
  });
  return instance;
}
