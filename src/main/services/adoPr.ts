import type { PrListFilter, PullRequest, RelevantPr } from '@shared/types';

/** Raw entry from the ADO `git/pullrequests` REST `value[]`. */
interface RawAdoPr {
  pullRequestId?: number;
  title?: string;
  sourceRefName?: string; // refs/heads/<branch> — the "from" branch
  targetRefName?: string; // refs/heads/<branch> — the "against" branch
  status?: string; // active | completed | abandoned
  createdBy?: { displayName?: string } | null;
  /** Set when the source branch is in a fork. */
  forkSource?: { name?: string } | null;
  isDraft?: boolean;
}

interface AdoPrContext {
  organizationUrl: string;
  project: string;
  repository: string;
}

/** Strip the `refs/heads/` prefix ADO uses on branch refs. */
export function adoSourceBranchName(sourceRefName: string): string {
  return sourceRefName.replace(/^refs\/heads\//, '');
}

export function mapAdoPrList(raw: unknown, ctx: AdoPrContext): PullRequest[] {
  if (!Array.isArray(raw)) return [];
  const baseUrl = ctx.organizationUrl.replace(/\/+$/, '');
  return raw.map((entry) => {
    const r = entry as RawAdoPr;
    const id = r.pullRequestId ?? 0;
    return {
      number: id,
      title: r.title ?? '',
      url: `${baseUrl}/${ctx.project}/_git/${ctx.repository}/pullrequest/${id}`,
      // The list query filters to status=active, so everything here is open.
      state: 'open' as const,
      author: r.createdBy?.displayName ?? '',
      headRefName: r.sourceRefName ? adoSourceBranchName(r.sourceRefName) : '',
      baseRefName: r.targetRefName ? adoSourceBranchName(r.targetRefName) : '',
      provider: 'ado' as const,
      fromFork: !!r.forkSource,
    };
  });
}

/**
 * The relevant-PR rows of the same listing. ADO's list carries a draft flag
 * but no update time, line counts, threads, checks or work items, nor who you
 * are: they're null here, and the ADO forge fills them in (the viewer on
 * every row, the rest for the newest; `list` in `prReview/ado.ts`).
 */
export function mapAdoRelevantPrs(raw: unknown, ctx: AdoPrContext): RelevantPr[] {
  const entries = Array.isArray(raw) ? (raw as RawAdoPr[]) : [];
  return mapAdoPrList(entries, ctx).map((pr, i) => ({
    ...pr,
    draft: entries[i]?.isDraft === true,
    updatedAt: null,
    additions: null,
    deletions: null,
    threads: null,
    ci: null,
    viewer: null,
    issues: null,
    verdict: null,
    headUrl: null,
    commits: null,
  }));
}

/** The `git/pullrequests` query for the active PRs, narrowed by `filter`. */
export function adoPrListQuery(filter: PrListFilter = {}): string {
  const ref = (name: string) => encodeURIComponent(`refs/heads/${name}`);
  return [
    'searchCriteria.status=active',
    ...(filter.head ? [`searchCriteria.sourceRefName=${ref(filter.head)}`] : []),
    ...(filter.base ? [`searchCriteria.targetRefName=${ref(filter.base)}`] : []),
    '$top=50',
  ].join('&');
}
