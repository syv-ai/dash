import type { PrProvider, PrRef, PullRequest, Task, TaskReviewTarget } from '@shared/types';

/** What finding a task's review target takes. */
export interface ReviewTargetDeps {
  /** The PR the person picked for the task to review, or null. */
  storedTarget(taskId: string): PrRef | null;
  getTask(id: string): Pick<Task, 'projectId' | 'path' | 'branch'> | undefined;
  /** The project's open PRs, listed from checkout `cwd`, and their provider. */
  openPrs(projectId: string, cwd: string): Promise<{ provider: PrProvider; prs: PullRequest[] }>;
  /** The branch checked out at `cwd`; null on a detached HEAD. */
  branchOf(cwd: string): Promise<string | null>;
}

/** The newest open PR from `branch`, or null. */
export function ownOpenPr(prs: readonly PullRequest[], branch: string): number | null {
  const own = prs.filter((p) => p.state === 'open' && p.headRefName === branch);
  return own.length > 0 ? Math.max(...own.map((p) => p.number)) : null;
}

/** The task's own open PR (from the branch its checkout is on now), or null.
 *  Rejects when the provider can't be asked (no remote, ADO not configured,
 *  gh offline): that says nothing about whether there is one. */
export async function ownReviewPr(taskId: string, deps: ReviewTargetDeps): Promise<PrRef | null> {
  const task = deps.getTask(taskId);
  if (!task) return null;
  const branch = (await deps.branchOf(task.path)) ?? task.branch;
  const { provider, prs } = await deps.openPrs(task.projectId, task.path);
  const number = ownOpenPr(prs, branch);
  return number === null ? null : { provider, number };
}

/**
 * The PR a task reviews: the one the person picked, else the task's own open
 * PR, else null. The one rule for the app and dashctl. Rejects as
 * `ownReviewPr` does when it has to ask the provider.
 */
export async function effectiveReviewTarget(
  taskId: string,
  deps: ReviewTargetDeps,
): Promise<TaskReviewTarget | null> {
  const stored = deps.storedTarget(taskId);
  if (stored) return { ...stored, source: 'stored' };
  const own = await ownReviewPr(taskId, deps);
  return own && { ...own, source: 'own' };
}

const samePr = (a: PrRef, b: PrRef) => a.provider === b.provider && a.number === b.number;

/**
 * Pick the PR the task reviews (null stops reviewing) and answer its target
 * now. The task's own PR is never stored: it is the target without a pick, and
 * a stored one would outlive it (still pinned once it merges and the next one
 * opens), so picking it clears the pick. If the provider can't say which is
 * the own PR, the pick is stored as given.
 */
export async function pickReviewTarget(
  taskId: string,
  target: PrRef | null,
  deps: ReviewTargetDeps & { store(taskId: string, target: PrRef | null): void },
): Promise<TaskReviewTarget | null> {
  const own = target && (await ownReviewPr(taskId, deps).catch(() => null));
  deps.store(taskId, target && own && samePr(own, target) ? null : target);
  return effectiveReviewTarget(taskId, deps);
}
