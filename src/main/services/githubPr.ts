import type { PullRequest, PullRequestInfo, PullRequestState } from '@shared/types';
import { ciFromRollup } from './prRelevance';

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

/** `gh pr list`'s arguments for the repo's open PRs (the new-task PR picker). */
export function githubPrListArgs(): string[] {
  return ['pr', 'list', '--state', 'open', '--json', GITHUB_PR_FIELDS, '--limit', '50'];
}

/** The PRs of `gh pr list --json number,title,url,state,headRefOid,statusCheckRollup`. */
export function githubBranchPrsFrom(raw: unknown): PullRequestInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: Record<string, unknown>): PullRequestInfo => {
    const state = r.state === 'MERGED' ? 'merged' : r.state === 'OPEN' ? 'open' : 'closed';
    return {
      number: Number(r.number) || 0,
      title: String(r.title ?? ''),
      url: String(r.url ?? ''),
      state,
      provider: 'github',
      headSha: typeof r.headRefOid === 'string' ? r.headRefOid : undefined,
      ci: state === 'open' ? ciFromRollup(r.statusCheckRollup) : null,
    };
  });
}
