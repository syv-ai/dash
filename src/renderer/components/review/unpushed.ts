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

/**
 * Whether the PR's head as last detected for the task (its badge's lookup,
 * refetched as HEAD moves, D97) has moved past the head the review was loaded
 * at: a push landed, so the review should reload now rather than at its next
 * 60 s refresh (D96). Not while either is unknown.
 */
export const headMovedPast = (
  detected: string | undefined,
  loaded: string | null | undefined,
): boolean => !!detected && !!loaded && detected !== loaded;
