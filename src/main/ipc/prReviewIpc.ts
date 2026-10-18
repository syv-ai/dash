import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { DatabaseService } from '../services/DatabaseService';
import { ConnectionConfigService } from '../services/ConnectionConfigService';
import { prContextFor, type PrContextDeps } from '../services/prReview/resolve';

/** The app's lookups for picking a project's PR provider. */
const appDeps: PrContextDeps = {
  getProject: (id) => DatabaseService.getProjects().find((p) => p.id === id),
  getAdoConfig: (projectId) => ConnectionConfigService.getAdoConfig(projectId),
};

const where = { projectId: z.string(), cwd: z.string() };

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
}
