import type { PrViewerInvolvement, RelevantPr, Task } from './types';

/** A project's open PR as its PR list shows it: the PR, and the task whose
 *  branch is its head, if any. */
export interface ProjectPr {
  pr: RelevantPr;
  taskId: string | null;
}

/** A project's open PRs by where you stand on them, each in the listing's
 *  order (newest first). */
export interface ProjectPrGroups {
  /** You're asked to review it, or it's assigned to you and isn't yours. */
  waiting: ProjectPr[];
  /** You opened it. */
  yours: ProjectPr[];
  /** The rest, and every PR whose forge couldn't say who you are. */
  others: ProjectPr[];
}

/** Which group a PR goes in, from where you stand on it (null: unknown). */
export function prGroupOf(viewer: PrViewerInvolvement | null): keyof ProjectPrGroups {
  if (!viewer) return 'others';
  if (viewer.isRequestedReviewer || (viewer.isAssignee && !viewer.isAuthor)) return 'waiting';
  return viewer.isAuthor ? 'yours' : 'others';
}

/**
 * The task a PR's head branch is checked out in: the project's task on
 * `headRefName`, a live one before an archived one. A fork's PR has none:
 * its head is a same-named branch in the fork, not this repo's.
 */
export function taskForPr(
  pr: Pick<RelevantPr, 'headRefName' | 'fromFork'>,
  tasks: readonly Pick<Task, 'id' | 'branch' | 'archivedAt'>[],
): string | null {
  if (pr.fromFork || !pr.headRefName) return null;
  const on = tasks.filter((t) => t.branch === pr.headRefName);
  return (on.find((t) => !t.archivedAt) ?? on[0])?.id ?? null;
}

/** A project's open PRs, grouped by where you stand on them, each with its task. */
export function groupProjectPrs(
  prs: readonly RelevantPr[],
  tasks: readonly Pick<Task, 'id' | 'branch' | 'archivedAt'>[],
): ProjectPrGroups {
  const groups: ProjectPrGroups = { waiting: [], yours: [], others: [] };
  for (const pr of prs) groups[prGroupOf(pr.viewer)].push({ pr, taskId: taskForPr(pr, tasks) });
  return groups;
}
