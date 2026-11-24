import type { PrRef, TaskReviewTarget } from '@shared/types';
import { DatabaseService } from '../DatabaseService';
import { ConnectionConfigService } from '../ConnectionConfigService';
import { GitService } from '../GitService';
import { taskReviewTargetsRepo } from '../taskReviewTargetsRepo';
import { prContextFor, type PrContextDeps } from './resolve';
import { effectiveReviewTarget, pickReviewTarget, type ReviewTargetDeps } from './reviewTarget';

/** The app's lookups for picking a project's PR provider. */
export const appPrContextDeps: PrContextDeps = {
  getProject: (id) => DatabaseService.getProjects().find((p) => p.id === id),
  getAdoConfig: (projectId) => ConnectionConfigService.getAdoConfig(projectId),
};

const reviewTargetDeps: ReviewTargetDeps = {
  storedTarget: (id) => taskReviewTargetsRepo().get(id),
  getTask: (id) => DatabaseService.getTask(id),
  branchOf: (cwd) => GitService.getBranch(cwd),
  async openPrs(projectId, cwd) {
    const { provider, adapter, ctx } = prContextFor(projectId, cwd, appPrContextDeps);
    return { provider, prs: await adapter.list(ctx) };
  },
};

/** The task's review target over the app's database and providers (see `effectiveReviewTarget`). */
export function appReviewTarget(taskId: string): Promise<TaskReviewTarget | null> {
  return effectiveReviewTarget(taskId, reviewTargetDeps);
}

/** Pick the task's review target in the app's database (see `pickReviewTarget`). */
export function appPickReviewTarget(
  taskId: string,
  target: PrRef | null,
): Promise<TaskReviewTarget | null> {
  return pickReviewTarget(taskId, target, {
    ...reviewTargetDeps,
    store: (id, t) => taskReviewTargetsRepo().set(id, t),
  });
}
