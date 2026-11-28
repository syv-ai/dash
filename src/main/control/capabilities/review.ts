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
import { parsePrScope, prScope } from '../../../shared/prScope';
import { anchorStatus, canDemote, isReplyDraft, replyAnchor } from '../../../shared/diffComments';
import { ControlError, defineCapability, type Registry } from '../registry';
import type { TaskReviews } from '../../services/prReview/taskReview';
import { SummaryConflictError } from '../../services/prReviewSummariesRepo';

export interface ReviewCapabilityDeps {
  /** Where the project's PRs live (from its remote). */
  /** Null when the project's remote isn't on a forge Dash has a provider for. */
  providerFor(projectId: string): PrProvider | null;
  getTask(id: string): Task | undefined;
  reviews: TaskReviews;
  /** The PR the task is in review mode for, else its branch's own open PR, else null. */
  defaultPr(taskId: string): Promise<PrRef | null>;
  /** The PR's review as the editor loads it, from the task's checkout. Reads only. */
  loadReview(task: Task, pr: PrRef): Promise<PrReview>;
  /** PR `number`'s head commit now. */
  prHead(task: Task, number: number): Promise<string>;
  /** The id of PR `number`'s thread that `ref` names, as the provider posts replies to; null if none. */
  replyThread(task: Task, number: number, ref: string): Promise<string | null>;
  /** Bring Dash to the front on the task in review mode for the PR. Throws a
   *  ControlError when it can't. */
  openPr(task: Task, pr: PrRef): void;
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
    const provider = number === undefined ? null : deps.providerFor(task.projectId);
    if (number !== undefined && !provider) {
      throw new ControlError(400, "this project's remote isn't on GitHub or Azure DevOps");
    }
    const pr =
      number === undefined ? await deps.defaultPr(taskId) : { provider: provider!, number };
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

  /** A reply's file and lines: its thread's, which must be on the PR, and the
   *  thread's id. `replyTo` may name the thread or one of its comments (on
   *  GitHub its node or REST id), which the provider resolves; an unknown one
   *  would fail the whole review at Submit. */
  const replyLines = async (
    taskId: string,
    pr: PrRef,
    input: {
      replyTo: string;
      kind: string;
      path?: string;
      startLine?: number;
      endLine?: number;
      commit?: string;
    },
  ): Promise<Pick<DiffComment, 'filePath' | 'startLine' | 'endLine' | 'replyTo'>> => {
    if (input.kind !== 'comment') {
      throw new ControlError(400, 'a reply is a comment: pass --kind comment');
    }
    if (input.path !== undefined || input.startLine !== undefined || input.endLine !== undefined) {
      throw new ControlError(400, "a reply sits on its thread's lines: drop --path and the lines");
    }
    if (input.commit !== undefined) {
      throw new ControlError(400, 'a reply sits on its thread, not on a commit: drop --commit');
    }
    const task = deps.getTask(taskId)!;
    const [threadId, review] = await Promise.all([
      fromProvider(`check --reply-to against PR #${pr.number}`, () =>
        deps.replyThread(task, pr.number, input.replyTo),
      ),
      reviewOf(taskId, pr),
    ]);
    const thread = threadId ? review.threads.find((t) => t.id === threadId) : undefined;
    if (!thread) {
      throw new ControlError(
        404,
        `PR #${pr.number} has no thread ${JSON.stringify(input.replyTo)}: --reply-to takes the id of a thread or of one of its comments`,
      );
    }
    return { ...replyAnchor(thread), replyTo: thread.id };
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
  async function fromProvider<T>(what: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      throw new ControlError(502, `could not ${what}: ${message(err)}`);
    }
  }

  /** PR `number`'s head now, to anchor a line draft to; null when it can't be
   *  read (the draft is still written, its status 'unknown'). */
  const headOrNull = (taskId: string, number: number) =>
    deps.prHead(deps.getTask(taskId)!, number).catch(() => null);

  const numberOf = (c: DiffComment) => parsePrScope(c.viewScope)!.number;

  /** Each PR's head now, for the drafts' statuses; a head that can't be read is left out. */
  const headsFor = async (taskId: string, drafts: DiffComment[]) => {
    const numbers = new Set(drafts.filter((c) => !isReplyDraft(c) && c.commit).map(numberOf));
    const heads = new Map<number, string>();
    await Promise.all(
      [...numbers].map(async (n) => {
        const head = await headOrNull(taskId, n);
        if (head) heads.set(n, head);
      }),
    );
    return (c: DiffComment) => heads.get(numberOf(c));
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
        "List a task's notes and draft review comments (on lines, or replies to threads), the user's and the agent's: on one PR, or with --all-prs on every PR the task has drafts on. A line draft's status says whether it was written on the PR's head now ('current'), on an older one ('moved': Submit holds it back), or isn't known.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        allPrs: z
          .boolean()
          .optional()
          .describe('Every PR the task has drafts on, instead of one; not with --number'),
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
        if (input.allPrs && input.number !== undefined) {
          throw new ControlError(400, 'give --number or --all-prs, not both');
        }
        const listed = input.allPrs
          ? deps.reviews.allDrafts(taskId)
          : deps.reviews.drafts(taskId, await prFor(taskId, input.number, input.provider));
        const drafts = listed.filter(
          (c) =>
            (!input.provider || parsePrScope(c.viewScope)?.provider === input.provider) &&
            (!input.kind || c.kind === input.kind) &&
            (!input.author || c.author === input.author) &&
            (!input.path || c.filePath === input.path.replace(/^\/+/, '')),
        );
        const headOfDraft = await headsFor(taskId, drafts);
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
        "Write a note or draft a review comment on a PR's lines (a comment there starts a thread), or draft a reply to one of its threads, in the task's diff editor. Nothing is posted: the person reviews, edits and posts comments; notes stay local. For a comment on the whole PR, use `dashctl review summary-set` instead.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        number: NUMBER,
        provider: PROVIDER,
        path: PATH.optional().describe(
          "Repo-relative path in the PR's version of the file; not with --reply-to",
        ),
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
            "Reply to this thread instead of starting one: the thread's id (from `dashctl review threads`), or the id of one of its comments (on GitHub, its node id or REST id). It sits on the thread's lines, and is a comment",
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
        const pr = await prFor(taskId, input.number, input.provider);
        const replyTo = input.replyTo;
        const where = replyTo
          ? await replyLines(taskId, pr, { ...input, replyTo })
          : { ...lines(input), replyTo: null };
        // A line draft records the head its lines are in; Submit checks it.
        const head = where.replyTo || input.commit ? null : await headOrNull(taskId, pr.number);
        const draft = deps.reviews.saveAgentDraft({
          id: randomUUID(),
          taskId,
          ...where,
          text: input.body,
          viewScope: prScope(pr.provider, pr.number),
          commit: where.replyTo ? null : (input.commit ?? head),
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
        number: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Move it to this PR (the project's); a reply can't move"),
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
        if (input.kind === 'note' && input.kind !== draft.kind && !canDemote(draft)) {
          throw new ControlError(400, 'a reply stays a comment');
        }
        const from = parsePrScope(draft.viewScope)!;
        const number = input.number ?? from.number;
        // The draft's own PR, unless it moves: its provider is the scope's.
        const pr =
          input.number === undefined
            ? { provider: from.provider, number }
            : await prFor(taskId, number, input.provider);
        if (input.provider && input.provider !== pr.provider) {
          throw new ControlError(400, `this PR is on ${pr.provider}`);
        }
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
        const head = moved && !input.commit ? await headOrNull(taskId, number) : undefined;
        // The head lookup awaited: the person may have edited the draft meanwhile,
        // and this write is built on the version read before it.
        const now = draftOrThrow(taskId, input.id);
        if (now.updatedAt !== draft.updatedAt) {
          throw new ControlError(
            409,
            `draft ${draft.id} changed while it was being updated; read it again with drafts-get`,
            view(now),
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
        number: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'With --all, the PR to clear (required: --all never defaults); with ids, refuse any draft not on it',
          ),
        provider: PROVIDER,
        all: z.boolean().optional().describe('Every draft on the PR'),
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
          // Destructive: the PR it clears is named, never the default one.
          if (input.number === undefined) throw new ControlError(400, '--all needs --number');
          if (input.ifUnchangedSince !== undefined) {
            throw new ControlError(400, '--if-unchanged-since takes one draft id, not --all');
          }
        } else {
          if (ids.length === 0) {
            throw new ControlError(400, 'give draft ids, or --all with --number');
          }
          if (input.kind || input.author) {
            throw new ControlError(400, '--kind and --author narrow --all; ids name the drafts');
          }
          if (input.ifUnchangedSince !== undefined && ids.length !== 1) {
            throw new ControlError(400, '--if-unchanged-since takes exactly one draft id');
          }
        }
        // With ids, a PR is a check only when one is named.
        const pr =
          input.number === undefined ? null : await prFor(taskId, input.number, input.provider);
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
              `draft ${c.id} is on PR #${numberOf(c)}, not #${pr.number}; nothing was deleted`,
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
        const pr = await prFor(taskId, input.number, input.provider);
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
        'Bring Dash to the front on the task in review mode for a PR: where the person reads your drafts on it and posts them. Use it for a PR the task is not reviewing yet.',
      input: z.object({ taskId: TASK_ID_FIELD, number: NUMBER, provider: PROVIDER }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        deps.openPr(deps.getTask(taskId)!, await prFor(taskId, input.number, input.provider));
        return {};
      },
    }),
  );
}
