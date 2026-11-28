import type { PrRef, RelevantPrs, TaskPrs } from '@shared/types';
import { DatabaseService } from '../DatabaseService';
import { TelemetryService } from '../TelemetryService';
import { ConnectionConfigService } from '../ConnectionConfigService';
import { GitService } from '../GitService';
import { hasGit } from '../../utils/gitPresence';
import { taskReviewModesRepo } from '../taskReviewModesRepo';
import { prContextFor, type PrContextDeps } from './resolve';
import { listRelevantPrs } from './relevantPrs';
import { defaultReviewPr, settleReviewMode, type ReviewModeDeps } from './reviewMode';

/** The app's lookups for picking a project's PR provider. */
export const appPrContextDeps: PrContextDeps = {
  getProject: (id) => DatabaseService.getProjects().find((p) => p.id === id),
  getAdoConfig: (projectId) => ConnectionConfigService.getAdoConfig(projectId),
};

/** The open PRs from and into the branch task `taskId`'s checkout is on now
 *  (see `listRelevantPrs`); none, with no forge asked, for a plain folder. */
async function appRelevantPrs(taskId: string): Promise<RelevantPrs> {
  const task = DatabaseService.getTask(taskId);
  if (!task) throw new Error('Unknown task');
  const branch = hasGit(task.path)
    ? ((await GitService.getBranch(task.path)) ?? task.branch)
    : null;
  const { adapter, ctx } = prContextFor(task.projectId, task.path, appPrContextDeps);
  return listRelevantPrs((filter) => adapter.list(ctx, filter), branch);
}

const reviewModeDeps: ReviewModeDeps = {
  storedMode: (id) => taskReviewModesRepo().get(id),
  storeMode: (id, pr) => taskReviewModesRepo().set(id, pr),
  relevantPrs: appRelevantPrs,
};

/** The task's relevant PRs and review mode, over the app's database and forge
 *  (see `settleReviewMode`). */
export function appTaskPrs(taskId: string): Promise<TaskPrs> {
  return settleReviewMode(taskId, reviewModeDeps);
}

/** Enter review mode for `pr` (null exits it). */
export function appSetReviewMode(taskId: string, pr: PrRef | null): void {
  reviewModeDeps.storeMode(taskId, pr);
  TelemetryService.capture(
    pr ? 'review_mode_entered' : 'review_mode_exited',
    pr ? { provider: pr.provider } : {},
  );
}

/** dashctl's PR without `--number` (see `defaultReviewPr`). */
export function appDefaultReviewPr(taskId: string): Promise<PrRef | null> {
  return defaultReviewPr(taskId, reviewModeDeps);
}
