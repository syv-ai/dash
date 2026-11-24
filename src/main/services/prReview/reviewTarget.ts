import type { PrProvider, PrRef, PullRequest, Task } from '@shared/types';

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

/**
 * The PR a task reviews: the one the person picked, else the task's own open
 * PR (from the branch its checkout is on now), else null. A provider that
 * can't be asked (no remote, ADO not configured, gh offline) means no own PR.
 */
export async function effectiveReviewTarget(
  taskId: string,
  deps: ReviewTargetDeps,
): Promise<PrRef | null> {
  const stored = deps.storedTarget(taskId);
  if (stored) return stored;
  const task = deps.getTask(taskId);
  if (!task) return null;
  try {
    const branch = (await deps.branchOf(task.path)) ?? task.branch;
    const { provider, prs } = await deps.openPrs(task.projectId, task.path);
    const number = ownOpenPr(prs, branch);
    return number === null ? null : { provider, number };
  } catch {
    return null;
  }
}
