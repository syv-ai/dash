import type { PullRequest } from '@shared/types';

/** Raw entry from the ADO `git/pullrequests` REST `value[]`. */
interface RawAdoPr {
  pullRequestId?: number;
  title?: string;
  sourceRefName?: string; // refs/heads/<branch>
  status?: string; // active | completed | abandoned
  createdBy?: { displayName?: string } | null;
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
      provider: 'ado' as const,
    };
  });
}
