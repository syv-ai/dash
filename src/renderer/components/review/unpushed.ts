import type { TaskReviewTarget } from '../../../shared/types';

/**
 * Whether the task's checkout is on the PR's head branch, so its local
 * commits could be the PR's next push: the branch's own PR, or a picked one
 * whose head is the branch checked out now (null: detached).
 */
export const onPrHeadBranch = (
  source: TaskReviewTarget['source'],
  headRef: string,
  branch: string | null,
): boolean => source === 'own' || (branch !== null && headRef === branch);

/** "2 local commits aren't in the PR yet — push to include them." */
export const unpushedLine = (n: number): string =>
  n === 1
    ? "1 local commit isn't in the PR yet — push to include it."
    : `${n} local commits aren't in the PR yet — push to include them.`;
