import { randomUUID } from 'crypto';
import { z } from 'zod';
import type {
  DiffComment,
  PrProvider,
  PrRef,
  PrReview,
  PrReviewComment,
  PrReviewThread,
  Task,
} from '../../../shared/types';
import { prScope } from '../../../shared/prScope';
import { canDemote, replyAnchor } from '../../../shared/diffComments';
import { ControlError, defineCapability, type Registry } from '../registry';
import type { TaskReviews } from '../../services/prReview/taskReview';

export interface ReviewCapabilityDeps {
  /** Where the project's PRs live (from its remote). */
  providerFor(projectId: string): PrProvider;
  getTask(id: string): Task | undefined;
  reviews: TaskReviews;
  /** The PR the task is in review mode for, else its branch's own open PR, else null. */
  defaultPr(taskId: string): Promise<PrRef | null>;
  /** The PR's review as the editor loads it, from the task's checkout. Reads only. */
  loadReview(task: Task, pr: PrRef): Promise<PrReview>;
}

const TASK_ID_FIELD = z
  .string()
  .optional()
  .describe('The task whose drafts these are; an agent inside a task may leave it out for its own');
const NUMBER = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "The PR number (ADO: the pull request id); defaults to the PR the task is in review mode for, else the task's own open PR",
  );
const PROVIDER = z
  .enum(['github', 'ado'])
  .optional()
  .describe("Where the PR lives; defaults to the project's remote");
const BODY = z.string().trim().min(1).max(65_536).describe('The comment, in Markdown');
const LINE = z.number().int().min(1);
const KIND = z
  .enum(['note', 'comment'])
  .describe(
    "'comment': a review comment for the PR's author, posted when the person submits the review. " +
      "'note': for the developer working on the task, something to be aware of; it never reaches the PR. " +
      'The person can promote a note to a comment.',
  );

/** What an agent sees of a draft. */
function view(c: DiffComment) {
  return {
    id: c.id,
    path: c.filePath,
    startLine: c.startLine,
    endLine: c.endLine,
    side: c.side,
    replyTo: c.replyTo,
    kind: c.kind,
    body: c.text,
    author: c.author,
  };
}

/** What an agent sees of a posted comment. */
const commentView = (c: PrReviewComment) => ({
  id: c.id,
  author: c.author,
  body: c.body,
  createdAt: c.createdAt,
});

/** What an agent sees of a review thread. */
function threadView(t: PrReviewThread) {
  return {
    id: t.id,
    path: t.path,
    line: t.line,
    startLine: t.startLine,
    side: t.side,
    outdated: t.isOutdated,
    resolved: t.resolved,
    url: t.comments[0]?.url ?? null,
    comments: t.comments.map(commentView),
  };
}

/** What an agent sees of a PR: what it is, where it stands, what it changes. */
function prView(r: PrReview, conversation: boolean) {
  return {
    provider: r.provider,
    number: r.number,
    title: r.title,
    body: r.body,
    url: r.url,
    author: r.author,
    viewerIsAuthor: r.viewerIsAuthor,
    state: r.state,
    createdAt: r.createdAt,
    lastActivityAt: r.lastActivityAt,
    baseRef: r.baseRef,
    headRef: r.headRef,
    commits: r.commits,
    behindBase: r.behindBase,
    reviewers: r.reviewers,
    assignees: r.assignees,
    checks: r.checks.map(({ name, state }) => ({ name, state })),
    files: r.files.map(({ path, oldPath, status, additions, deletions }) => ({
      path,
      ...(oldPath ? { oldPath } : {}),
      status,
      additions,
      deletions,
    })),
    ...(conversation ? { conversation: r.conversation.map(commentView) } : {}),
  };
}

const byLocation = (a: PrReviewThread, b: PrReviewThread) =>
  a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0);

/**
 * Read the PR a task reviews and its threads, and write notes and draft PR
 * review comments in the task's diff editor, for the person to edit and post.
 * Nothing here writes to the PR itself: posting, resolving and voting stay
 * with the person, in the UI.
 */
export function registerReviewCapabilities(registry: Registry, deps: ReviewCapabilityDeps): void {
  /** The PR a call is about: `number` on the task's project's provider, else
   *  the task's review-mode PR, else its own. Refuses a provider it isn't on, and no PR at all. */
  const prFor = async (taskId: string, number?: number, asked?: PrProvider): Promise<PrRef> => {
    const task = deps.getTask(taskId)!;
    const pr =
      number === undefined
        ? await deps.defaultPr(taskId)
        : { provider: deps.providerFor(task.projectId), number };
    if (!pr) throw new ControlError(400, 'No pull request to review: pass --number');
    if (asked && asked !== pr.provider) {
      throw new ControlError(400, `this PR is on ${pr.provider}`);
    }
    return pr;
  };

  /** The PR's review, loaded from the task's checkout. */
  const reviewOf = (taskId: string, pr: PrRef) => deps.loadReview(deps.getTask(taskId)!, pr);

  /** A line draft's file and lines, as given. */
  const lines = (input: {
    path?: string;
    startLine?: number;
    endLine?: number;
  }): Pick<DiffComment, 'filePath' | 'startLine' | 'endLine'> => {
    if (!input.path || input.startLine === undefined) {
      throw new ControlError(400, 'pass --path and --start-line, or --reply-to <thread-id>');
    }
    const endLine = input.endLine ?? input.startLine;
    if (endLine < input.startLine) throw new ControlError(400, '--end-line is before --start-line');
    return { filePath: input.path.replace(/^\/+/, ''), startLine: input.startLine, endLine };
  };

  /** A reply's file and lines: its thread's, which must be on the PR. */
  const replyLines = async (
    taskId: string,
    pr: PrRef,
    input: { replyTo?: string; kind: string; path?: string; startLine?: number; endLine?: number },
  ): Promise<Pick<DiffComment, 'filePath' | 'startLine' | 'endLine'>> => {
    if (input.kind !== 'comment') {
      throw new ControlError(400, 'a reply is a comment: pass --kind comment');
    }
    if (input.path !== undefined || input.startLine !== undefined || input.endLine !== undefined) {
      throw new ControlError(400, "a reply sits on its thread's lines: drop --path and the lines");
    }
    const thread = (await reviewOf(taskId, pr)).threads.find((t) => t.id === input.replyTo);
    if (!thread) throw new ControlError(404, `thread not found on PR #${pr.number}`);
    return replyAnchor(thread);
  };

  /** The target task's PR note or draft, the person's or an agent's, or a 404.
   *  Nothing here reaches the PR, so the person still reviews every change. */
  const draftOrThrow = (taskId: string, id: string): DiffComment => {
    const draft = deps.reviews.draft(taskId, id);
    if (!draft) throw new ControlError(404, 'draft not found');
    return draft;
  };

  registry.register(
    defineCapability({
      name: 'review.pr',
      summary:
        "Read a PR's overview, without its threads. It has the title, description, author, branches, state, reviewers, checks and changed files; `viewerIsAuthor` says whether it is the person's own PR.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        conversation: z
          .boolean()
          .optional()
          .describe("Add the PR's general comments and review summaries, oldest first"),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const review = await reviewOf(taskId, await prFor(taskId, input.number, input.provider));
        return prView(review, input.conversation ?? false);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.threads',
      summary:
        "Read a PR's review threads on its files, unresolved ones by default. Each has its file and lines, whether it is resolved or outdated, and its comments.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        state: z
          .enum(['unresolved', 'resolved', 'all'])
          .optional()
          .describe('Which threads; defaults to unresolved'),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const review = await reviewOf(taskId, await prFor(taskId, input.number, input.provider));
        const state = input.state ?? 'unresolved';
        return review.threads
          .filter((t) => state === 'all' || t.resolved === (state === 'resolved'))
          .sort(byLocation)
          .map(threadView);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_list',
      summary:
        "List a task's notes and draft review comments on a PR (on lines, or replies to its threads), the user's and the agent's.",
      input: z.object({ taskId: TASK_ID_FIELD, number: NUMBER, provider: PROVIDER }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const pr = await prFor(input.taskId!, input.number, input.provider);
        return deps.reviews
          .drafts(input.taskId!, pr)
          .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine)
          .map(view);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_create',
      summary:
        "Write a note or draft a review comment on a PR's lines (a comment there starts a thread), or draft a reply to one of its threads, in the task's diff editor. Nothing is posted: the person reviews, edits and posts comments; notes stay local. For a comment on the whole PR, use `dashctl review summary-set` instead.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        path: z
          .string()
          .min(1)
          .optional()
          .describe("Repo-relative path in the PR's version of the file; not with --reply-to"),
        startLine: LINE.optional().describe(
          "First line, in the PR's version of the file; not with --reply-to",
        ),
        endLine: LINE.optional().describe('Last line; defaults to startLine'),
        body: BODY,
        kind: KIND,
        replyTo: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Reply to this thread (its id from `dashctl review threads`) instead of starting one; it sits on the thread's lines, and is a comment",
          ),
      }),
      callers: ['orchestrator', 'task'],
      cli: { stdin: 'body' },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const pr = await prFor(taskId, input.number, input.provider);
        const where = input.replyTo ? await replyLines(taskId, pr, input) : lines(input);
        const draft = deps.reviews.saveAgentDraft({
          id: randomUUID(),
          taskId,
          ...where,
          text: input.body,
          viewScope: prScope(pr.provider, pr.number),
          replyTo: input.replyTo ?? null,
          kind: input.kind,
        });
        return view(draft);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_update',
      summary:
        "Change a note or draft review comment, the person's or the agent's: its text, lines or kind.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        id: z.string().describe('From `dashctl review drafts-list`'),
        body: BODY.optional(),
        startLine: LINE.optional(),
        endLine: LINE.optional(),
        kind: KIND.optional(),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['id'], stdin: 'body' },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        // dashctl reads a piped body only for `--body -`: say so rather than exit 0.
        if (
          input.body === undefined &&
          input.startLine === undefined &&
          input.endLine === undefined &&
          input.kind === undefined
        ) {
          throw new ControlError(400, 'nothing to change: give a body, startLine, endLine or kind');
        }
        const draft = draftOrThrow(taskId, input.id);
        if (input.kind === 'note' && input.kind !== draft.kind && !canDemote(draft)) {
          throw new ControlError(400, 'a reply stays a comment');
        }
        const startLine = input.startLine ?? draft.startLine;
        const endLine = input.endLine ?? Math.max(startLine, draft.endLine);
        if (endLine < startLine) throw new ControlError(400, '--end-line is before --start-line');
        const saved = deps.reviews.saveAgentDraft({
          id: draft.id,
          taskId,
          filePath: draft.filePath,
          startLine,
          endLine,
          text: input.body ?? draft.text,
          viewScope: draft.viewScope,
          replyTo: draft.replyTo,
          kind: input.kind ?? draft.kind,
        });
        return view(saved);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_delete',
      summary: "Delete a note or draft review comment, the person's or the agent's.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        id: z.string().describe('From `dashctl review drafts-list`'),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['id'] },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        draftOrThrow(taskId, input.id);
        deps.reviews.deleteAgentDraft(taskId, input.id);
        return { ok: true };
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.summary_get',
      summary:
        "The task's draft summary for a PR: the review's PR-level comment, posted with the verdict on Submit. Null when there is none.",
      input: z.object({ taskId: TASK_ID_FIELD, number: NUMBER, provider: PROVIDER }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const pr = await prFor(input.taskId!, input.number, input.provider);
        return deps.reviews.getSummary(input.taskId!, pr);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.summary_set',
      summary:
        "Draft the review's summary: the PR-level comment (not on any line) the person posts with the verdict on Submit. Replaces the current draft, the person's too; an empty body clears it. Nothing is posted.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        body: z.string().max(65_536).describe('The summary, in Markdown; empty clears it'),
      }),
      callers: ['orchestrator', 'task'],
      cli: { stdin: 'body' },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const pr = await prFor(taskId, input.number, input.provider);
        deps.reviews.setSummary(taskId, pr, { body: input.body, author: 'agent' });
        return deps.reviews.getSummary(taskId, pr);
      },
    }),
  );
}
