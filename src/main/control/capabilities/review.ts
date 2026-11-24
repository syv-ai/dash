import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { DiffComment, PrProvider, Task } from '../../../shared/types';
import { parsePrScope, prScope } from '../../../shared/prScope';
import { anchorStatus, isReplyDraft } from '../../../shared/diffComments';
import { ControlError, defineCapability, type Registry } from '../registry';
import type { PrRef, TaskReviews } from '../../services/prReview/taskReview';
import { SummaryConflictError } from '../../services/prReviewsInProgressRepo';

export interface ReviewCapabilityDeps {
  /** Where the project's PRs live (from its remote). */
  providerFor(projectId: string): PrProvider;
  getTask(id: string): Task | undefined;
  /** PR `number`'s head commit now. */
  prHead(task: Task, number: number): Promise<string>;
  /** The id of PR `number`'s thread that `ref` names, as the provider posts replies to; null if none. */
  replyThread(task: Task, number: number, ref: string): Promise<string | null>;
  /** Bring Dash to the front on the task's diff editor, showing the PR. Throws a
   *  ControlError when it can't. */
  openPr(task: Task, pr: PrRef): void;
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
const PATH = z.string().min(1).describe("Repo-relative path in the PR's version of the file");
const KIND = z
  .enum(['note', 'comment'])
  .describe(
    "'comment': a review comment for the PR's author, posted when the person submits the review. " +
      "'note': for the developer working on the task, something to be aware of; it never reaches the PR. " +
      'The person can promote a note to a comment.',
  );
const AUTHOR = z.enum(['user', 'agent']);
const COMMIT = z
  .string()
  .regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/i, 'a full commit hash')
  .describe(
    "The PR head commit the lines are in, in full; defaults to the PR's head now. Submit holds back a draft written on an older head",
  );
const IF_UNCHANGED_SINCE = z
  .string()
  .optional()
  .describe(
    'Refuse (409) unless it is still this version: the updatedAt you last read. Guards against overwriting what the person changed since',
  );

/** What an agent sees of a draft. `head` is its PR's head now, when known: a line
 *  draft says whether it was written on it. */
function view(c: DiffComment, head?: string | null) {
  return {
    id: c.id,
    number: parsePrScope(c.viewScope)?.number,
    path: c.filePath,
    startLine: c.startLine,
    endLine: c.endLine,
    side: c.side,
    replyTo: c.replyTo,
    kind: c.kind,
    body: c.text,
    author: c.author,
    ...(isReplyDraft(c) ? {} : { commit: c.commit, status: anchorStatus(c, head) }),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Write notes and draft PR review comments in a task's diff editor, for the
 * person to edit and submit. Nothing here touches the PR itself: submitting,
 * resolving and voting stay with the person, in the UI.
 */
export function registerReviewCapabilities(registry: Registry, deps: ReviewCapabilityDeps): void {
  const taskOf = (taskId: string) => deps.getTask(taskId)!;

  /** The task's project's PR `number`, refusing a provider it isn't on. */
  const prFor = (taskId: string, number: number, asked?: PrProvider): PrRef => {
    const provider = deps.providerFor(taskOf(taskId).projectId);
    if (asked && asked !== provider) {
      throw new ControlError(400, `this project's PRs are on ${provider}`);
    }
    return { provider, number };
  };

  /** The target task's PR note or draft, the person's or an agent's, or a 404.
   *  Nothing here reaches the PR, so the person still reviews every change. */
  const draftOrThrow = (taskId: string, id: string): DiffComment => {
    const draft = deps.reviews.draft(taskId, id);
    if (!draft) throw new ControlError(404, `draft ${id} not found`);
    return draft;
  };

  /** Refuse a write to a draft that changed since the version the agent read. */
  const assertUnchanged = (draft: DiffComment, since: string | undefined) => {
    if (since !== undefined && draft.updatedAt !== since) {
      throw new ControlError(
        409,
        `draft ${draft.id} changed since ${since} (it's at ${draft.updatedAt} now); read it again with drafts-get`,
        view(draft),
      );
    }
  };

  /** A call to the PR's provider; its failure is a 502 saying what couldn't be done. */
  const fromProvider = async <T>(what: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (err) {
      throw new ControlError(502, `could not ${what}: ${message(err)}`);
    }
  };

  /** PR `number`'s head now, to anchor a line draft to; null when it can't be
   *  read (the draft is still written, its status 'unknown'). */
  const headOrNull = (taskId: string, number: number) =>
    deps.prHead(taskOf(taskId), number).catch(() => null);

  /** Each PR's head now, for the drafts' statuses; a head that can't be read is left out. */
  const headsFor = async (taskId: string, drafts: DiffComment[]) => {
    const numbers = new Set(
      drafts
        .filter((c) => !isReplyDraft(c) && c.commit)
        .map((c) => parsePrScope(c.viewScope)!.number),
    );
    const heads = new Map<number, string>();
    await Promise.all(
      [...numbers].map(async (n) => {
        const head = await deps.prHead(taskOf(taskId), n).catch(() => null);
        if (head) heads.set(n, head);
      }),
    );
    return (c: DiffComment) => heads.get(parsePrScope(c.viewScope)!.number);
  };

  /** The PR thread `ref` names, checked now: an unknown one would fail the whole review at Submit. */
  const replyThreadOrThrow = async (taskId: string, number: number, ref: string) => {
    const thread = await fromProvider(`check --reply-to against PR #${number}`, () =>
      deps.replyThread(taskOf(taskId), number, ref),
    );
    if (!thread) {
      throw new ControlError(
        400,
        `PR #${number} has no thread ${JSON.stringify(ref)}: --reply-to takes the id of a thread or of one of its comments`,
      );
    }
    return thread;
  };

  registry.register(
    defineCapability({
      name: 'review.drafts_list',
      summary:
        "List a task's notes and draft review comments (on lines, or replies to threads), the user's and the agent's: on one PR, or on every PR the task has drafts on. A line draft's status says whether it was written on the PR's head now ('current'), on an older one ('moved': Submit holds it back), or isn't known.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER.optional().describe('Only this PR; left out, every PR'),
        provider: PROVIDER,
        kind: KIND.optional().describe('Only notes, or only comments'),
        author: AUTHOR.optional().describe("Only the person's, or only an agent's"),
        path: PATH.optional().describe('Only drafts on this file'),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        // Refuses a provider the project isn't on, with a number or without.
        const pr = prFor(taskId, input.number ?? 0, input.provider);
        const drafts = (
          input.number === undefined
            ? deps.reviews.allDrafts(taskId)
            : deps.reviews.drafts(taskId, pr)
        ).filter(
          (c) =>
            (!input.kind || c.kind === input.kind) &&
            (!input.author || c.author === input.author) &&
            (!input.path || c.filePath === input.path.replace(/^\/+/, '')),
        );
        const headOfDraft = await headsFor(taskId, drafts);
        const numberOf = (c: DiffComment) => parsePrScope(c.viewScope)!.number;
        return drafts
          .sort(
            (a, b) =>
              numberOf(a) - numberOf(b) ||
              a.filePath.localeCompare(b.filePath) ||
              a.startLine - b.startLine,
          )
          .map((c) => view(c, headOfDraft(c)));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_get',
      summary: "One of a task's notes or draft review comments, as drafts-list shows it.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        id: z.string().describe('From `dashctl review drafts-list`'),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['id'] },
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const draft = draftOrThrow(input.taskId!, input.id);
        return view(draft, (await headsFor(input.taskId!, [draft]))(draft));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_create',
      summary:
        "Write a note or draft a review comment on a PR's lines (or a reply to one of its threads) in the task's diff editor. Nothing is posted: the person reviews, edits and submits comments; notes stay local. For a comment on the whole PR, use `dashctl review summary-set` instead.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        path: PATH,
        startLine: LINE.describe("First line, in the PR's version of the file"),
        endLine: LINE.optional().describe('Last line; defaults to startLine'),
        body: BODY,
        kind: KIND,
        replyTo: z
          .string()
          .optional()
          .describe(
            "Reply to this thread instead of starting one: the thread's id, or the id of one of its comments (on GitHub, its node id or REST id)",
          ),
        commit: COMMIT.optional(),
      }),
      callers: ['orchestrator', 'task'],
      cli: { stdin: 'body' },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const { provider, number } = prFor(taskId, input.number, input.provider);
        const endLine = input.endLine ?? input.startLine;
        if (endLine < input.startLine)
          throw new ControlError(400, '--end-line is before --start-line');
        if (input.replyTo !== undefined && input.commit !== undefined) {
          throw new ControlError(400, 'a reply sits on its thread, not on a commit: drop --commit');
        }
        const replyTo =
          input.replyTo === undefined
            ? null
            : await replyThreadOrThrow(taskId, number, input.replyTo);
        // A line draft records the head its lines are in; Submit checks it.
        const head = replyTo || input.commit ? null : await headOrNull(taskId, number);
        const draft = deps.reviews.saveAgentDraft({
          id: randomUUID(),
          taskId,
          filePath: input.path.replace(/^\/+/, ''),
          startLine: input.startLine,
          endLine,
          text: input.body,
          viewScope: prScope(provider, number),
          replyTo,
          commit: replyTo ? null : (input.commit ?? head),
          kind: input.kind,
        });
        return view(draft, head ?? (await headsFor(taskId, [draft]))(draft));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_update',
      summary:
        "Change a note or draft review comment, the person's or the agent's: its text or kind, or move it to other lines, another file or another PR, keeping its id and author. A moved line draft is anchored to its PR's head now, unless --commit says otherwise.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        id: z.string().describe('From `dashctl review drafts-list`'),
        body: BODY.optional(),
        kind: KIND.optional(),
        number: NUMBER.optional().describe(
          "Move it to this PR (the project's); a reply can't move",
        ),
        provider: PROVIDER,
        path: PATH.optional().describe("Move it to this file; a reply can't move"),
        startLine: LINE.optional().describe(
          'New first line; without endLine the range moves with it, keeping its length',
        ),
        endLine: LINE.optional(),
        commit: COMMIT.optional(),
        ifUnchangedSince: IF_UNCHANGED_SINCE,
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['id'], stdin: 'body' },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const changes = [
          input.body,
          input.kind,
          input.number,
          input.path,
          input.startLine,
          input.endLine,
          input.commit,
        ];
        // dashctl reads a piped body only for `--body -`: say so rather than exit 0.
        if (changes.every((v) => v === undefined)) {
          throw new ControlError(
            400,
            'nothing to change: give a body, kind, number, path, startLine, endLine or commit',
          );
        }
        const draft = draftOrThrow(taskId, input.id);
        assertUnchanged(draft, input.ifUnchangedSince);
        const from = parsePrScope(draft.viewScope)!;
        const number = input.number ?? from.number;
        const pr = prFor(taskId, number, input.provider);
        const filePath = input.path?.replace(/^\/+/, '') ?? draft.filePath;
        const reply = isReplyDraft(draft);
        if (reply && (number !== from.number || filePath !== draft.filePath || input.commit)) {
          throw new ControlError(
            400,
            "a reply belongs to its thread: it can't move to another PR, file or commit. Delete it and draft it again",
          );
        }
        const startLine = input.startLine ?? draft.startLine;
        const endLine = input.endLine ?? startLine + (draft.endLine - draft.startLine);
        if (endLine < startLine) throw new ControlError(400, '--end-line is before --start-line');
        // Placing a line draft again anchors it to the code it's on now. Its own
        // PR's number given back is a check, not a move.
        const moved =
          !reply &&
          (number !== from.number ||
            filePath !== draft.filePath ||
            [input.startLine, input.endLine, input.commit].some((v) => v !== undefined));
        const head = moved ? await headOrNull(taskId, number) : undefined;
        // The head lookup awaited: the person may have edited the draft meanwhile,
        // and this write is built on the version read before it.
        if (draftOrThrow(taskId, input.id).updatedAt !== draft.updatedAt) {
          throw new ControlError(
            409,
            `draft ${draft.id} changed while it was being updated; read it again with drafts-get`,
            view(draftOrThrow(taskId, input.id)),
          );
        }
        const saved = deps.reviews.saveAgentDraft({
          id: draft.id,
          taskId,
          filePath,
          startLine,
          endLine,
          text: input.body ?? draft.text,
          viewScope: prScope(pr.provider, number),
          replyTo: draft.replyTo,
          commit: moved ? (input.commit ?? head ?? null) : draft.commit,
          kind: input.kind ?? draft.kind,
        });
        return view(saved, head ?? (await headsFor(taskId, [saved]))(saved));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.drafts_delete',
      summary:
        "Delete notes and draft review comments, the person's or the agent's: the ones named by id, or with --all every one on a PR (narrowed by --kind and --author). All or nothing: an id that isn't the task's refuses the lot.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        ids: z
          .array(z.string())
          .optional()
          .describe('From `dashctl review drafts-list`; several may be given'),
        number: NUMBER.optional().describe(
          'With --all, the PR to clear; with ids, refuse any draft not on it',
        ),
        provider: PROVIDER,
        all: z.boolean().optional().describe('Every draft on the PR given by --number'),
        kind: KIND.optional().describe('With --all, only notes or only comments'),
        author: AUTHOR.optional().describe("With --all, only the person's or only an agent's"),
        ifUnchangedSince: IF_UNCHANGED_SINCE.describe(
          'With one id: refuse (409) unless the draft is still at this version, the updatedAt you last read',
        ),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['ids'] },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const ids = [...new Set(input.ids ?? [])];
        if (input.all === true) {
          if (ids.length > 0) throw new ControlError(400, 'give draft ids or --all, not both');
          if (input.number === undefined) throw new ControlError(400, '--all needs --number');
          if (input.ifUnchangedSince !== undefined) {
            throw new ControlError(400, '--if-unchanged-since takes one draft id, not --all');
          }
        } else {
          if (ids.length === 0)
            throw new ControlError(400, 'give draft ids, or --all with --number');
          if (input.kind || input.author) {
            throw new ControlError(400, '--kind and --author narrow --all; ids name the drafts');
          }
          if (input.ifUnchangedSince !== undefined && ids.length !== 1) {
            throw new ControlError(400, '--if-unchanged-since takes exactly one draft id');
          }
        }
        const pr = input.number === undefined ? null : prFor(taskId, input.number, input.provider);
        const targets = input.all
          ? deps.reviews
              .drafts(taskId, pr!)
              .filter(
                (c) =>
                  (!input.kind || c.kind === input.kind) &&
                  (!input.author || c.author === input.author),
              )
          : ids.map((id) => draftOrThrow(taskId, id));
        for (const c of targets) {
          if (pr && c.viewScope !== prScope(pr.provider, pr.number)) {
            throw new ControlError(
              400,
              `draft ${c.id} is on PR #${parsePrScope(c.viewScope)!.number}, not #${pr.number}; nothing was deleted`,
            );
          }
          assertUnchanged(c, input.ifUnchangedSince);
        }
        const deleted = targets.map((c) => c.id);
        deps.reviews.deleteAgentDrafts(taskId, deleted);
        return { deleted };
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.summary_get',
      summary:
        "The task's draft summary for a PR: the review's PR-level comment, posted with the verdict on Submit, and its updatedAt. Null when there is none.",
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
        ifUnchangedSince: IF_UNCHANGED_SINCE.describe(
          "Refuse (409) unless the summary is still at this version, the updatedAt you last read ('' for none)",
        ),
      }),
      callers: ['orchestrator', 'task'],
      cli: { stdin: 'body' },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const pr = prFor(taskId, input.number, input.provider);
        try {
          deps.reviews.setSummary(
            taskId,
            pr,
            { body: input.body, author: 'agent' },
            input.ifUnchangedSince,
          );
        } catch (err) {
          if (!(err instanceof SummaryConflictError)) throw err;
          throw new ControlError(
            409,
            `the summary changed since ${input.ifUnchangedSince || 'there was none'}; read it again with summary-get`,
            err.current,
          );
        }
        return deps.reviews.getSummary(taskId, pr);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'review.open',
      summary:
        "Bring Dash to the front on the task's diff editor, showing a PR: where the person reads and submits your drafts on it. Use it for a PR that isn't the task's own branch.",
      input: z.object({ taskId: TASK_ID_FIELD, number: NUMBER, provider: PROVIDER }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        deps.openPr(taskOf(taskId), prFor(taskId, input.number, input.provider));
        return {};
      },
    }),
  );
}
