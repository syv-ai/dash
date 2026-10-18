import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PrReview, PrReviewComment, PrReviewThread, PrVerdict } from '@shared/types';
import { GithubService } from '../GithubService';
import { ensureCommits, runGit } from './localCommits';
import type { PrReviewProvider } from './types';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 15_000;

/** A PR's review threads, general comments and review summaries, and the commits its diff spans. */
export const PR_REVIEW_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title
      url
      viewerDidAuthor
      baseRefOid
      headRefOid
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id isResolved isOutdated path line startLine diffSide
          comments(first: 50) { nodes { id author { login } body createdAt url } }
        }
      }
      comments(first: 100) { nodes { id author { login } body createdAt url } }
      reviews(first: 100) { nodes { id author { login } body state createdAt url } }
    }
  }
}`;

type Node = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const nodes = (v: unknown): Node[] => {
  const list = (v as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(list) ? list.filter((n): n is Node => !!n && typeof n === 'object') : [];
};

function commentFrom(c: Node): PrReviewComment {
  return {
    id: str(c.id),
    // A deleted account comes back without an author, as GitHub's "ghost".
    author: str((c.author as { login?: unknown } | null)?.login) || 'ghost',
    body: str(c.body),
    createdAt: str(c.createdAt),
    url: str(c.url),
  };
}

function threadFrom(t: Node): PrReviewThread {
  return {
    id: str(t.id),
    path: str(t.path),
    line: num(t.line),
    startLine: num(t.startLine),
    side: t.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
    isOutdated: t.isOutdated === true,
    resolved: t.isResolved === true,
    comments: nodes(t.comments).map(commentFrom),
  };
}

const GITHUB_VERDICTS: PrVerdict[] = ['comment', 'approve', 'request_changes'];

/** The PrReview of PR_REVIEW_QUERY's `pullRequest` node, given the commits its diff spans. */
export function githubReviewFrom(
  pr: unknown,
  { number, base, head }: { number: number; base: string; head: string },
): PrReview {
  const p = (pr && typeof pr === 'object' ? pr : {}) as Node;
  const viewerIsAuthor = p.viewerDidAuthor === true;
  // A review's summary belongs in the conversation; one without a body (just
  // inline comments) or still pending says nothing there.
  const summaries = nodes(p.reviews).filter((r) => str(r.body).trim() && r.state !== 'PENDING');
  const conversation = [...nodes(p.comments), ...summaries]
    .map(commentFrom)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const threads = p.reviewThreads as { pageInfo?: { hasNextPage?: unknown } } | undefined;
  return {
    provider: 'github',
    number,
    title: str(p.title),
    url: str(p.url),
    viewerIsAuthor,
    verdicts: viewerIsAuthor ? ['comment'] : GITHUB_VERDICTS,
    base,
    head,
    threads: nodes(p.reviewThreads).map(threadFrom),
    conversation,
    ...(threads?.pageInfo?.hasNextPage === true ? { partial: true } : {}),
  };
}

async function queryPr(cwd: string, number: number): Promise<Node> {
  const { stdout } = await execFileAsync(
    'gh',
    [
      'api',
      'graphql',
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-F',
      `number=${number}`,
      '-f',
      `query=${PR_REVIEW_QUERY}`,
    ],
    {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const pr = JSON.parse(stdout)?.data?.repository?.pullRequest;
  if (!pr) throw new Error(`PR #${number} not found`);
  return pr as Node;
}

export const githubProvider: PrReviewProvider = {
  list: (ctx) => GithubService.listPullRequests(ctx.cwd),

  async load(ctx, number) {
    const pr = await queryPr(ctx.cwd, number);
    const head = str(pr.headRefOid);
    const baseTip = str(pr.baseRefOid);
    await ensureCommits(ctx.cwd, [baseTip, head]);
    const base = (await runGit(ctx.cwd, ['merge-base', baseTip, head], TIMEOUT_MS)).trim();
    return githubReviewFrom(pr, { number, base, head });
  },

  setResolved: () => Promise.reject(new Error('not implemented')),
  submit: () => Promise.reject(new Error('not implemented')),
};
