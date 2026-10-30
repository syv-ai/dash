/**
 * Whether the local branch the user picks is what the task actually runs on.
 *
 * A new branch inside a worktree is cut from the freshly fetched `origin/<name>`,
 * so the local branch's ahead/behind state is irrelevant. Every other mode
 * checks the local branch out directly, where it matters.
 */
export function isDirectCheckout(opts: { createNewBranch: boolean; useWorktree: boolean }) {
  return !opts.createNewBranch || !opts.useWorktree;
}
