import type { PullRequest } from '../../../../shared/types';

const bare = (ref: string) => ref.replace(/^refs\/heads\//, '');

/** The PRs that matter to a branch: opened from it, or targeting it. */
export function relevantPrs(prs: readonly PullRequest[], branch: string): PullRequest[] {
  return prs.filter((p) => bare(p.headRefName) === branch || bare(p.baseRefName) === branch);
}
