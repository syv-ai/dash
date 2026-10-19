import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { DatabaseService } from '../services/DatabaseService';
import { ConnectionConfigService } from '../services/ConnectionConfigService';
import { prContextFor, type PrContextDeps } from '../services/prReview/resolve';
import { diffCommentsRepo } from '../services/diffCommentsRepo';
import { prReviewsInProgressRepo } from '../services/prReviewsInProgressRepo';
import { emitDiffCommentsChanged } from '../services/diffCommentEvents';
import type { PrProvider, PrVerdict } from '@shared/types';

/** The app's lookups for picking a project's PR provider. */
const appDeps: PrContextDeps = {
  getProject: (id) => DatabaseService.getProjects().find((p) => p.id === id),
  getAdoConfig: (projectId) => ConnectionConfigService.getAdoConfig(projectId),
};

const where = { projectId: z.string(), cwd: z.string() };
const reviewOf = { taskId: z.string(), provider: z.enum(['github', 'ado']), number: z.number() };
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
  ipcMain.handle('prReview:list', async (_e, args: { projectId: string; cwd: string }) => {
    try {
      parseArgs('prReview:list', z.looseObject(where), args);
      const { provider, adapter, ctx } = prContextFor(args.projectId, args.cwd, appDeps);
      return { success: true, data: { provider, prs: await adapter.list(ctx) } };
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
        return { success: true, data: await adapter.load(ctx, args.number) };
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

  ipcMain.handle(
    'prReview:inReview',
    (_e, args: { taskId: string; provider: PrProvider; number: number }) => {
      try {
        parseArgs('prReview:inReview', z.looseObject(reviewOf), args);
        const on = prReviewsInProgressRepo().isInReview(args.taskId, args.provider, args.number);
        return { success: true, data: on };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle(
    'prReview:setInReview',
    (_e, args: { taskId: string; provider: PrProvider; number: number; on: boolean }) => {
      try {
        parseArgs('prReview:setInReview', z.looseObject({ ...reviewOf, on: z.boolean() }), args);
        prReviewsInProgressRepo().setInReview(args.taskId, args.provider, args.number, args.on);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  /**
   * Submit the task's drafts for the PR with a verdict. Main reads the drafts
   * itself, and deletes the ones that reached the PR; a submit that all got
   * through ends the review, so what's written next is a note again. A write the provider
   * refused still answers `success`, carrying the error, so the renderer can
   * show its fix.
   */
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
        const repo = diffCommentsRepo();
        const drafts = repo.listPrDrafts(args.taskId, provider, args.number);
        const result = await adapter.submit(ctx, args.number, {
          verdict: args.verdict,
          body: args.body,
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
          repo.deleteByIds(result.postedDraftIds);
          emitDiffCommentsChanged(args.taskId);
        }
        if (!result.error) {
          prReviewsInProgressRepo().setInReview(args.taskId, provider, args.number, false);
        }
        return { success: true, data: result };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
