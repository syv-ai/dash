import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { DiffComment, PrProvider, Task } from '../../../shared/types';
import { prScope } from '../../../shared/prScope';
import { ControlError, defineCapability, type Registry } from '../registry';
import type { AgentDraft } from '../../services/diffCommentsRepo';

export interface ReviewCapabilityDeps {
  /** Where the project's PRs live (from its remote). */
  providerFor(projectId: string): PrProvider;
  getTask(id: string): Task | undefined;
  /** The task's notes and comments in a PR's view scope. */
  listByScope(taskId: string, scope: string): DiffComment[];
  getDraft(id: string): DiffComment | undefined;
  saveAgentDraft(draft: AgentDraft): DiffComment;
  deleteDraft(id: string): void;
  /** Tell an open diff editor the task's drafts changed. */
  changed(taskId: string): void;
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
  const scopeFor = (taskId: string, number: number, asked?: PrProvider) => {
    const task = deps.getTask(taskId)!;
    const provider = deps.providerFor(task.projectId);
    if (asked && asked !== provider) {
      throw new ControlError(400, `this project's PRs are on ${provider}`);
    }
    return { provider, scope: prScope(provider, number) };
  };

  /** The target task's own agent-written draft, or a 403/404 saying why not. */
  const ownAgentDraftOrThrow = (taskId: string, id: string): DiffComment => {
    const draft = deps.getDraft(id);
    if (!draft || draft.taskId !== taskId || !draft.viewScope.startsWith('pr:')) {
      throw new ControlError(404, 'draft not found');
    }
    if (draft.author !== 'agent') {
      throw new ControlError(
        403,
        "only drafts written by an agent can be changed; this one is the user's",
      );
    }
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
        const { scope } = scopeFor(input.taskId!, input.number, input.provider);
        return deps
          .listByScope(input.taskId!, scope)
          .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine)
          .map(view);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_create',
      summary:
        "Write a note or draft a review comment on a PR's lines (or a reply to one of its threads) in the task's diff editor. Nothing is posted: the person reviews, edits and submits comments; notes stay local.",
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
        const { scope } = scopeFor(taskId, input.number, input.provider);
        const endLine = input.endLine ?? input.startLine;
        if (endLine < input.startLine) throw new ControlError(400, 'endLine is before startLine');
        const draft = deps.saveAgentDraft({
          id: randomUUID(),
          taskId,
          filePath: input.path.replace(/^\/+/, ''),
          startLine: input.startLine,
          endLine,
          text: input.body,
          viewScope: scope,
          replyTo: input.replyTo ?? null,
          kind: input.kind,
        });
        deps.changed(taskId);
        return view(draft);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_update',
      summary:
        "Change a note or draft review comment the agent wrote: its text, lines or kind. The person's own can't be changed.",
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
        const draft = ownAgentDraftOrThrow(taskId, input.id);
        const startLine = input.startLine ?? draft.startLine;
        const endLine = input.endLine ?? Math.max(startLine, draft.endLine);
        if (endLine < startLine) throw new ControlError(400, 'endLine is before startLine');
        const saved = deps.saveAgentDraft({
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
        deps.changed(taskId);
        return view(saved);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_delete',
      summary: "Delete a note or draft review comment the agent wrote. The person's own stay.",
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
        ownAgentDraftOrThrow(taskId, input.id);
        deps.deleteDraft(input.id);
        deps.changed(taskId);
        return { ok: true };
      },
    }),
  );
}
