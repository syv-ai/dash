import type { PullRequest, PullRequestState } from '@shared/types';

/** Raw entry from `gh pr list --json` (`GITHUB_PR_FIELDS`). */
interface RawGithubPr {
  number?: number;
  title?: string;
  url?: string;
  state?: string; // OPEN | MERGED | CLOSED
  headRefName?: string;
  baseRefName?: string;
  author?: { login?: string; name?: string } | null;
  /** The head is in another repository (a fork). */
  isCrossRepository?: boolean;
}

/** The fields `gh pr list` is asked for. */
const GITHUB_PR_FIELDS = 'number,title,url,state,headRefName,baseRefName,author,isCrossRepository';

function mapState(state: string | undefined): PullRequestState {
  if (state === 'MERGED') return 'merged';
  if (state === 'OPEN') return 'open';
  return 'closed';
}

export function mapGithubPrList(raw: unknown): PullRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const r = entry as RawGithubPr;
    return {
      number: r.number ?? 0,
      title: r.title ?? '',
      url: r.url ?? '',
      state: mapState(r.state),
      author: r.author?.login ?? '',
      headRefName: r.headRefName ?? '',
      baseRefName: r.baseRefName ?? '',
      provider: 'github' as const,
      fromFork: r.isCrossRepository === true,
    };
  });
}

/**
 * Refspec that fetches a PR head into a local branch. `refs/pull/<n>/head`
 * exists for every PR including fork PRs, so this works regardless of where
 * the head lives. The local branch is named after the PR head branch.
 */
export function buildPrHeadRefspec(prNumber: number, headRefName: string): string {
  return `pull/${prNumber}/head:${headRefName}`;
}

/** `gh pr list`'s arguments for the repo's open PRs (the new-task PR picker). */
export function githubPrListArgs(): string[] {
  return ['pr', 'list', '--state', 'open', '--json', GITHUB_PR_FIELDS, '--limit', '50'];
}
