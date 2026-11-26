import type { PullRequestInfo, PullRequestState } from '../../shared/types';

/** Per task branch (`<taskId>@<branch>`), each PR number seen from it and its last state. */
export type SeenBranchPrs = Record<string, Record<number, PullRequestState>>;

/**
 * Which PRs from task branches were opened or merged since the last look, for
 * analytics (`pr_opened`, `branch_merged`). A branch listed for the first time
 * says nothing (its PRs may predate Dash looking); after that, a PR number new
 * to it was opened, and a PR seen in another state that is now merged was
 * merged. Keyed by branch, so a task that switches branch (review mode checks
 * out a PR's) doesn't count that branch's PRs as new. PRs that drop out of a
 * listing are remembered.
 */
export function prOutcomes(
  seen: SeenBranchPrs,
  listed: Record<string, PullRequestInfo[]>,
): { opened: PullRequestInfo[]; merged: PullRequestInfo[]; next: SeenBranchPrs } {
  const next: SeenBranchPrs = { ...seen };
  const opened: PullRequestInfo[] = [];
  const merged: PullRequestInfo[] = [];
  for (const [key, prs] of Object.entries(listed)) {
    const before = seen[key];
    const states = { ...before };
    for (const pr of prs) {
      if (before) {
        const was = before[pr.number];
        if (was === undefined) opened.push(pr);
        if (pr.state === 'merged' && was !== 'merged') merged.push(pr);
      }
      states[pr.number] = pr.state;
    }
    next[key] = states;
  }
  return { opened, merged, next };
}
