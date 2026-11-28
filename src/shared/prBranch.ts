/**
 * The local branch a task on a PR works on, the same rule on every forge.
 *
 * A PR from one of the repo's own branches: that branch, tracking origin's.
 * A fork's PR: `pr/<number>/<head>`, with no upstream. Never the bare head
 * name, which may also be one of origin's branches: a task on it would count
 * ahead/behind against origin's same-named branch, and deleting the task with
 * its remote branch would delete origin's. With no upstream, a push from the
 * task fails with git's "no upstream branch" rather than landing on origin.
 */
export function prTaskBranch(pr: { number: number; headRefName: string; fromFork: boolean }) {
  return pr.fromFork ? `pr/${pr.number}/${pr.headRefName}` : pr.headRefName;
}

const FORK_BRANCH = /^pr\/(\d+)\/(.+)$/;

/** The fork PR a `pr/<number>/<head>` task branch is on; null for any other name. */
export function forkPrOfBranch(branch: string): { number: number; headRefName: string } | null {
  const m = FORK_BRANCH.exec(branch);
  return m ? { number: Number(m[1]), headRefName: m[2]! } : null;
}
