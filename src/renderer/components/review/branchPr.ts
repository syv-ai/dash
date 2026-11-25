import type { PullRequestInfo, RelevantPrs } from '../../../shared/types';

/** The branch's own PR, as far as the sidebar names it. */
export type BranchPr = Pick<PullRequestInfo, 'provider' | 'number' | 'title'>;

/**
 * The branch's own PR: the newest open PR from it, as the relevant listing
 * says (forks' same-named branches left out there). Until that listing has
 * landed, or when the forge couldn't be asked, the task's PR lookup answers
 * with its open PR. Null when the branch has none.
 */
export function branchPr(
  relevant: RelevantPrs | null,
  detected: readonly PullRequestInfo[] | undefined,
): BranchPr | null {
  if (relevant) return relevant.from[0] ?? null;
  const pr = detected?.[0];
  return pr && pr.state === 'open' ? pr : null;
}
