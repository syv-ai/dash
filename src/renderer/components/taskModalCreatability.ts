/**
 * Pure decision logic for the New Task modal's submit gating, extracted so it can
 * be unit-tested without a DOM (Dash has no jsdom test env).
 *
 * The tricky case: a git repo with no commits yet (fresh `git init`, no remote)
 * has zero branches and an unborn HEAD. Worktrees are impossible there (nothing
 * to branch from), so the task must run in-place — and we must NOT block submit
 * waiting for a branch selection that can never happen.
 */
export interface TaskCreatabilityInput {
  /** The project is a git repo (HEAD may still be unborn). */
  gitReady: boolean;
  /** A branch fetch has completed at least once (so an empty list is meaningful). */
  branchFetchDone: boolean;
  /** The last branch fetch errored (we then don't know the real branch set). */
  branchError: boolean;
  /** Number of branches found. */
  branchCount: number;
  /** A branch is currently selected. */
  hasSelectedBranch: boolean;
}

export interface TaskCreatability {
  /** Confirmed git repo with no commits/branches yet — worktrees impossible. */
  repoHasNoCommits: boolean;
  /** Submit must wait for a branch selection. */
  requiresBranchSelection: boolean;
}

export function getTaskCreatability(input: TaskCreatabilityInput): TaskCreatability {
  const repoHasNoCommits =
    input.gitReady && input.branchFetchDone && !input.branchError && input.branchCount === 0;
  const requiresBranchSelection = input.gitReady && !repoHasNoCommits && !input.hasSelectedBranch;
  return { repoHasNoCommits, requiresBranchSelection };
}
