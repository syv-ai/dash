import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { DiffComment, PrProvider, Task } from '../../../shared/types';
import { prScope } from '../../../shared/prScope';
import { ControlError, defineCapability, type Registry } from '../registry';
import type { PrRef, TaskReviews } from '../../services/prReview/taskReview';

export interface ReviewCapabilityDeps {
  /** Where the project's PRs live (from its remote). */
  providerFor(projectId: string): PrProvider;
  getTask(id: string): Task | undefined;
  reviews: TaskReviews;
}

const TASK_ID_FIELD = z
  .string()
  .optional()
  .describe('The task whose drafts these are; an agent inside a task may leave it out for its own');
const NUMBER = z.number().int().positive().describe('The PR number (ADO: the pull request id)');
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

/**
 * Write notes and draft PR review comments in a task's diff editor, for the
 * person to edit and submit. Nothing here touches the PR itself: submitting,
 * resolving and voting stay with the person, in the UI.
 */
export function registerReviewCapabilities(registry: Registry, deps: ReviewCapabilityDeps): void {
  /** The task's project's PR `number`, refusing a provider it isn't on. */
  const prFor = (taskId: string, number: number, asked?: PrProvider): PrRef => {
    const task = deps.getTask(taskId)!;
    const provider = deps.providerFor(task.projectId);
    if (asked && asked !== provider) {
      throw new ControlError(400, `this project's PRs are on ${provider}`);
    }
    return { provider, number };
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
      name: 'review.drafts_list',
      summary:
        "List a task's notes and draft review comments on a PR (on lines, or replies to its threads), the user's and the agent's.",
      input: z.object({ taskId: TASK_ID_FIELD, number: NUMBER, provider: PROVIDER }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const pr = prFor(input.taskId!, input.number, input.provider);
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
        "Write a note or draft a review comment on a PR's lines (or a reply to one of its threads) in the task's diff editor. Nothing is posted: the person reviews, edits and submits comments; notes stay local. For a comment on the whole PR, use review_summary_set instead.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        path: z.string().min(1).describe("Repo-relative path in the PR's version of the file"),
        startLine: LINE.describe("First line, in the PR's version of the file"),
        endLine: LINE.optional().describe('Last line; defaults to startLine'),
        body: BODY,
        kind: KIND,
        replyTo: z
          .string()
          .optional()
          .describe("Reply to this thread (the provider's thread id) instead of starting one"),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const { provider, number } = prFor(taskId, input.number, input.provider);
        const endLine = input.endLine ?? input.startLine;
        if (endLine < input.startLine) throw new ControlError(400, 'endLine is before startLine');
        const draft = deps.reviews.saveAgentDraft({
          id: randomUUID(),
          taskId,
          filePath: input.path.replace(/^\/+/, ''),
          startLine: input.startLine,
          endLine,
          text: input.body,
          viewScope: prScope(provider, number),
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
        id: z.string().describe('From review_drafts_list'),
        body: BODY.optional(),
        startLine: LINE.optional(),
        endLine: LINE.optional(),
        kind: KIND.optional(),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const draft = draftOrThrow(taskId, input.id);
        const startLine = input.startLine ?? draft.startLine;
        const endLine = input.endLine ?? Math.max(startLine, draft.endLine);
        if (endLine < startLine) throw new ControlError(400, 'endLine is before startLine');
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
        id: z.string().describe('From review_drafts_list'),
      }),
      callers: ['orchestrator', 'task'],
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
        const pr = prFor(input.taskId!, input.number, input.provider);
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
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const pr = prFor(taskId, input.number, input.provider);
        deps.reviews.setSummary(taskId, pr, { body: input.body, author: 'agent' });
        return deps.reviews.getSummary(taskId, pr);
      },
    }),
  );
}
