import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { prContextFor } from '../services/prReview/resolve';
import {
  appPrContextDeps as appDeps,
  appSetReviewMode,
  appTaskPrs,
} from '../services/prReview/appDeps';
import { loadPrReview } from '../services/prReview/loadReview';
import { checkoutVsHead } from '../services/prReview/localCommits';
import { taskReviews } from '../services/prReview/taskReview';
import { prViewedFilesRepo } from '../services/prViewedFilesRepo';
import type { PrProvider, PrRef, PrVerdict } from '@shared/types';

const where = { projectId: z.string(), cwd: z.string() };
const provider = z.enum(['github', 'ado']);
const reviewOf = { taskId: z.string(), provider, number: z.number() };
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
}
