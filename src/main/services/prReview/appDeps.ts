import type { PrRef, RelevantPrs, TaskReviewTarget } from '@shared/types';
import { DatabaseService } from '../DatabaseService';
import { ConnectionConfigService } from '../ConnectionConfigService';
import { GitService } from '../GitService';
import { taskReviewTargetsRepo } from '../taskReviewTargetsRepo';
import { prContextFor, type PrContextDeps } from './resolve';
import { listRelevantPrs } from './relevantPrs';
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

/** The open PRs from and into the branch task `taskId`'s checkout is on now
 *  (see `listRelevantPrs`). */
export async function appRelevantPrs(taskId: string): Promise<RelevantPrs> {
  const task = DatabaseService.getTask(taskId);
  if (!task) throw new Error('Unknown task');
  const branch = (await GitService.getBranch(task.path)) ?? task.branch;
  const { adapter, ctx } = prContextFor(task.projectId, task.path, appPrContextDeps);
  return listRelevantPrs((filter) => adapter.list(ctx, filter), branch);
}
