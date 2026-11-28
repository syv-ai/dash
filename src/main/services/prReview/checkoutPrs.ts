import type { PullRequestInfo } from '@shared/types';
import { forkPrOfBranch } from '@shared/prBranch';
import { GitService } from '../GitService';
import { relevantPrs } from '../prRelevance';
import type { ForgeProvider, PrContext } from './types';

/** The git reads `prsForCheckout` makes; the app's by default. */
export interface CheckoutGit {
  getBranch(cwd: string): Promise<string | null>;
  hasMovedPast(cwd: string, sha: string): Promise<boolean>;
}

const appGit: CheckoutGit = {
  getBranch: (cwd) => GitService.getBranch(cwd),
  hasMovedPast: (cwd, sha) => GitService.hasMovedPast(cwd, sha),
};

/**
 * The PRs from the branch checked out at `ctx.cwd`, newest first, with the
 * current ones flagged (see relevantPrs) and CI status on open ones. Reads
 * the live branch, so a session that switched branches gets the new
 * branch's PRs; none on the default branch or a detached HEAD. A fork PR's
 * task branch (`pr/<n>/<head>`, see `prTaskBranch`) has PR n, which the forge
 * lists under its head's own name; a branch only named like one keeps its own PRs.
 */
export async function prsForCheckout(
  adapter: Pick<ForgeProvider, 'prsFrom'>,
  ctx: PrContext,
  defaultBranch: string,
  git: CheckoutGit = appGit,
): Promise<PullRequestInfo[]> {
  const branch = await git.getBranch(ctx.cwd);
  if (!branch || branch === defaultBranch) return [];
  const fork = forkPrOfBranch(branch);
  const forks = fork
    ? (await adapter.prsFrom(ctx, fork.headRefName)).filter((p) => p.number === fork.number)
    : [];
  const prs = forks.length > 0 ? forks : await adapter.prsFrom(ctx, branch);
  return relevantPrs(prs, (sha) => git.hasMovedPast(ctx.cwd, sha));
}
