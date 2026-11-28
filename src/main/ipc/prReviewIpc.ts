import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import {
  prContextFor,
  prContextForProject,
  UnsupportedForgeError,
} from '../services/prReview/resolve';
import {
  appPrContextDeps as appDeps,
  appSetReviewMode,
  appTaskPrs,
} from '../services/prReview/appDeps';
import { loadPrDetails, loadPrReview } from '../services/prReview/loadReview';
import { checkoutVsHead } from '../services/prReview/localCommits';
import { taskReviews } from '../services/prReview/taskReview';
import { prsForCheckout } from '../services/prReview/checkoutPrs';
import { writeCiReport } from '../services/prReview/ciReportFile';
import { GitService } from '../services/GitService';
import { prViewedFilesRepo } from '../services/prViewedFilesRepo';
import { PR_REACTIONS } from '@shared/prReactions';
import type { GeneralReplyTarget } from '@shared/prGeneralReply';
import type { PrProvider, PrReactionContent, PrRef, PrVerdict } from '@shared/types';

const where = { projectId: z.string(), cwd: z.string() };
const provider = z.enum(['github', 'ado']);
const reviewOf = { taskId: z.string(), provider, number: z.number() };
const reaction = z.enum(PR_REACTIONS);
const verdict = z.enum([
  'comment',
  'approve',
  'request_changes',
  'approve_with_suggestions',
  'wait_for_author',
  'reject',
]);

/**
 * PR review for the diff editor, on GitHub or Azure DevOps. Every call names
 * the project and checkout; main picks the provider from the project's remote,
 * so the renderer never does.
 */
export function registerPrReviewIpc(): void {
  /** The open PRs from and into the task's branch, and the PR it is in review
   *  mode for, ended when it no longer holds (see `settleReviewMode`). */
  ipcMain.handle('prReview:relevant', async (_e, args: { taskId: string }) => {
    try {
      parseArgs('prReview:relevant', z.looseObject({ taskId: z.string() }), args);
      return { success: true, data: await appTaskPrs(args.taskId) };
    } catch (err) {
      return errorResponse(err);
    }
  });

  /** The PRs from the branch checked out at `cwd` (see `prsForCheckout`). */
  ipcMain.handle(
    'pr:forCheckout',
    async (_e, args: { projectId: string; cwd: string; defaultBranch: string }) => {
      try {
        parseArgs('pr:forCheckout', z.looseObject({ ...where, defaultBranch: z.string() }), args);
        const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        return { success: true, data: await prsForCheckout(adapter, ctx, args.defaultBranch) };
      } catch (err) {
        // A forge Dash has no provider for has no PRs to show, rather than a failed lookup.
        if (err instanceof UnsupportedForgeError) return { success: true, data: [] };
        return errorResponse(err);
      }
    },
  );

  /** The repo's open PRs, to start a task on. */
  ipcMain.handle('pr:listOpen', async (_e, args: { projectId: string; cwd: string }) => {
    try {
      parseArgs('pr:listOpen', z.looseObject(where), args);
      const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
      return { success: true, data: await adapter.listOpen(ctx) };
    } catch (err) {
      return errorResponse(err);
    }
  });

  /** Fetch a PR's head into a local branch for a new task's worktree. */
  ipcMain.handle(
    'pr:prepareBranch',
    async (_e, args: { projectId: string; cwd: string; number: number; headRefName: string }) => {
      try {
        parseArgs(
          'pr:prepareBranch',
          z.looseObject({ ...where, number: z.number(), headRefName: z.string().min(1) }),
          args,
        );
        const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        const branch = await adapter.prepareBranch(ctx, args);
        // The head may already be checked out (a prior task on this PR). The
        // modal blocks a worktree-existing checkout on it, same as any branch.
        const checkedOut = (await GitService.getCheckedOutBranches(args.cwd)).has(branch);
        return { success: true, data: { branch, checkedOut } };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** "Fix CI": write the PR's failed checks to a file in the checkout (see `writeCiReport`). */
  ipcMain.handle(
    'pr:writeCiReport',
    async (
      _e,
      args: { projectId: string; cwd: string; number: number; url: string; headSha?: string },
    ) => {
      try {
        parseArgs(
          'pr:writeCiReport',
          z.looseObject({
            ...where,
            number: z.number(),
            url: z.string(),
            headSha: z.string().optional(),
          }),
          args,
        );
        const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        const { number, url, headSha } = args;
        return { success: true, data: await writeCiReport(adapter, ctx, { number, url, headSha }) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** All the project's open PRs, newest first, with where you stand on each
   *  (see `groupProjectPrs`); null on a forge Dash has no provider for. Not
   *  `pr:listOpen`, which lists less of each PR, for the new-task PR list. */
  ipcMain.handle('pr:listProject', async (_e, args: { projectId: string }) => {
    try {
      parseArgs('pr:listProject', z.looseObject({ projectId: z.string() }), args);
      const { adapter, ctx } = prContextForProject(args.projectId, appDeps);
      return { success: true, data: await adapter.list(ctx) };
    } catch (err) {
      if (err instanceof UnsupportedForgeError) return { success: true, data: null };
      return errorResponse(err);
    }
  });

  /** PR `number` of the project as its forge tells it, with no git call
   *  (see `PrDetails`): the project's PR list expands a row into it. */
  ipcMain.handle('pr:details', async (_e, args: { projectId: string; number: number }) => {
    try {
      parseArgs('pr:details', z.looseObject({ projectId: z.string(), number: z.number() }), args);
      const { adapter, ctx } = prContextForProject(args.projectId, appDeps);
      return { success: true, data: await loadPrDetails(adapter, ctx, args.number) };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'prReview:load',
    async (_e, args: { projectId: string; cwd: string; number: number }) => {
      try {
        parseArgs('prReview:load', z.looseObject({ ...where, number: z.number() }), args);
        const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        return { success: true, data: await loadPrReview(adapter, ctx, args.number) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle(
    'prReview:setResolved',
    async (
      _e,
      args: { projectId: string; cwd: string; number: number; threadId: string; resolved: boolean },
    ) => {
      try {
        parseArgs(
          'prReview:setResolved',
          z.looseObject({
            ...where,
            number: z.number(),
            threadId: z.string(),
            resolved: z.boolean(),
          }),
          args,
        );
        const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        await adapter.setResolved(ctx, args.number, args.threadId, args.resolved);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** Give or take back the viewer's reaction on a comment, at once (posts on
   *  the click, D194). */
  ipcMain.handle(
    'prReview:react',
    async (
      _e,
      args: {
        projectId: string;
        cwd: string;
        number: number;
        commentId: string;
        content: PrReactionContent;
        on: boolean;
      },
    ) => {
      try {
        parseArgs(
          'prReview:react',
          z.looseObject({
            ...where,
            number: z.number(),
            commentId: z.string().min(1),
            content: reaction,
            on: z.boolean(),
          }),
          args,
        );
        const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        await adapter.react(ctx, args.number, args.commentId, args.content, args.on);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** Where the checkout at `cwd` stands against PR head `head`; null when
   *  `head` isn't in the checkout (see `checkoutVsHead`). */
  ipcMain.handle('prReview:checkout', async (_e, args: { cwd: string; head: string }) => {
    try {
      parseArgs('prReview:checkout', z.looseObject({ cwd: z.string(), head: z.string() }), args);
      return { success: true, data: await checkoutVsHead(args.cwd, args.head) };
    } catch (err) {
      return errorResponse(err);
    }
  });

  /** Enter review mode for a PR (null exits it). */
  ipcMain.handle('prReview:setMode', (_e, args: { taskId: string; pr: PrRef | null }) => {
    try {
      parseArgs(
        'prReview:setMode',
        z.looseObject({
          taskId: z.string(),
          pr: z.object({ provider, number: z.number() }).nullable(),
        }),
        args,
      );
      appSetReviewMode(args.taskId, args.pr);
      return { success: true };
    } catch (err) {
      return errorResponse(err);
    }
  });

  /** The PR's files the task marked viewed: path → the blob they were viewed at. */
  ipcMain.handle(
    'prReview:viewed',
    (_e, args: { taskId: string; provider: PrProvider; number: number }) => {
      try {
        parseArgs('prReview:viewed', z.looseObject(reviewOf), args);
        return { success: true, data: prViewedFilesRepo().list(args.taskId, args) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** Mark a PR file viewed at its head blob; a null blob unmarks it. */
  ipcMain.handle(
    'prReview:setViewed',
    (
      _e,
      args: {
        taskId: string;
        provider: PrProvider;
        number: number;
        path: string;
        blob: string | null;
      },
    ) => {
      try {
        parseArgs(
          'prReview:setViewed',
          z.looseObject({ ...reviewOf, path: z.string(), blob: z.string().nullable() }),
          args,
        );
        prViewedFilesRepo().set(args.taskId, args, args.path, args.blob);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle(
    'prReview:getSummary',
    (_e, args: { taskId: string; provider: PrProvider; number: number }) => {
      try {
        parseArgs('prReview:getSummary', z.looseObject(reviewOf), args);
        return { success: true, data: taskReviews().getSummary(args.taskId, args) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** The person's edit of the draft summary; an empty one clears it. */
  ipcMain.handle(
    'prReview:setSummary',
    (_e, args: { taskId: string; provider: PrProvider; number: number; body: string }) => {
      try {
        parseArgs('prReview:setSummary', z.looseObject({ ...reviewOf, body: z.string() }), args);
        taskReviews().setSummary(args.taskId, args, { body: args.body, author: 'user' });
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** Submit the task's drafts for the PR with a verdict (see `TaskReviews.submit`). A
   *  write the provider refused still answers `success`, carrying the error, so
   *  the renderer can show its fix. */
  ipcMain.handle(
    'prReview:submit',
    async (
      _e,
      args: {
        projectId: string;
        cwd: string;
        taskId: string;
        number: number;
        verdict: PrVerdict;
        body: string;
      },
    ) => {
      try {
        parseArgs(
          'prReview:submit',
          z.looseObject({
            ...where,
            taskId: z.string(),
            number: z.number(),
            verdict,
            body: z.string(),
          }),
          args,
        );
        const { provider, adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        const result = await taskReviews().submit(
          args.taskId,
          { provider, number: args.number },
          { adapter, ctx },
          args.verdict,
          args.body,
        );
        return { success: true, data: result };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** Post a reply to a thread at once (outside any review) and delete the draft
   *  it came from; answers the posted comment. */
  ipcMain.handle(
    'prReview:reply',
    async (
      _e,
      args: {
        projectId: string;
        cwd: string;
        taskId: string;
        number: number;
        threadId: string;
        body: string;
        draftId?: string;
      },
    ) => {
      try {
        parseArgs(
          'prReview:reply',
          z.looseObject({
            ...where,
            taskId: z.string(),
            number: z.number(),
            threadId: z.string(),
            body: z.string().trim().min(1),
            draftId: z.string().optional(),
          }),
          args,
        );
        const { provider, adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        const posted = await taskReviews().reply(
          args.taskId,
          { provider, number: args.number },
          { adapter, ctx },
          { threadId: args.threadId, body: args.body, draftId: args.draftId },
        );
        return { success: true, data: posted };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /** Reply to a general comment (the PR's conversation) at once, on the
   *  person's Post reply; no draft is kept. Answers the posted comment. */
  ipcMain.handle(
    'prReview:replyGeneral',
    async (
      _e,
      args: {
        projectId: string;
        cwd: string;
        number: number;
        to: GeneralReplyTarget;
        body: string;
      },
    ) => {
      try {
        parseArgs(
          'prReview:replyGeneral',
          z.looseObject({
            ...where,
            number: z.number(),
            to: z.object({ id: z.string().min(1), author: z.string(), body: z.string() }),
            body: z.string().trim().min(1),
          }),
          args,
        );
        const { adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
        return {
          success: true,
          data: await adapter.replyGeneral(ctx, args.number, args.to, args.body),
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
