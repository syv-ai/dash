import type { PrReviewThread } from '@shared/types';

/** The GraphQL query for a PR's review threads and the commits its diff spans. */
export const PR_REVIEW_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url
      baseRefName
      baseRefOid
      headRefOid
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line startLine diffSide
          comments(first: 50) { nodes { id author { login } body createdAt url } }
        }
      }
    }
  }
}`;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const nodes = (v: unknown): Record<string, unknown>[] => {
  const list = (v as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(list) ? list.filter((n) => !!n && typeof n === 'object') : [];
};

/** The unresolved review threads of PR_REVIEW_QUERY's `pullRequest` node. */
export function unresolvedThreadsFrom(pr: unknown): PrReviewThread[] {
  return nodes((pr as { reviewThreads?: unknown } | null)?.reviewThreads)
    .filter((t) => t.isResolved !== true)
    .map((t) => ({
      id: str(t.id),
      path: str(t.path),
      line: num(t.line),
      startLine: num(t.startLine),
      side: t.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
      isOutdated: t.isOutdated === true,
      comments: nodes(t.comments).map((c) => ({
        id: str(c.id),
        // A deleted account comes back without an author, as GitHub's "ghost".
        author: str((c.author as { login?: unknown } | null)?.login) || 'ghost',
        body: str(c.body),
        createdAt: str(c.createdAt),
        url: str(c.url),
      })),
    }));
}
