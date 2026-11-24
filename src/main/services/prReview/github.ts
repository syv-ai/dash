import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  PrCheck,
  PrReviewComment,
  PrReviewer,
  PrReviewThread,
  PrState,
  PrVerdict,
  PrWriteError,
} from '@shared/types';
import { GithubService } from '../GithubService';
import { githubChecks } from '../prRelevance';
import { ensureCommits, runGit } from './localCommits';
import type { ForgeReview, PrReviewProvider } from './types';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 15_000;

/** A PR's review threads, general comments and review summaries, and the commits its diff spans. */
export const PR_REVIEW_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title
      body
      url
      viewerDidAuthor
      author { login }
      state
      isDraft
      baseRefName
      headRefName
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
      reviewRequests(first: 100) {
        nodes { requestedReviewer { ... on User { login } ... on Team { name } } }
      }
      latestReviews(first: 100) { nodes { author { login } state } }
      assignees(first: 50) { nodes { login } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

type Node = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const login = (v: unknown): string => str((v as { login?: unknown } | null)?.login);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const nodes = (v: unknown): Node[] => {
  const list = (v as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(list) ? list.filter((n): n is Node => !!n && typeof n === 'object') : [];
};

function commentFrom(c: Node): PrReviewComment {
  return {
    id: str(c.id),
    // A deleted account comes back without an author, as GitHub's "ghost".
    author: login(c.author) || 'ghost',
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

function stateFrom(p: Node): PrState {
  if (p.state === 'MERGED') return 'merged';
  if (p.state === 'CLOSED') return 'closed';
  return p.isDraft === true ? 'draft' : 'open';
}

const REVIEW_STATES: Record<string, PrReviewer['state']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
};

/** Each reviewer's latest review, then the pending requests: a re-request
 *  outranks the review before it, as on GitHub. Dismissed reviews don't count. */
function reviewersFrom(p: Node): PrReviewer[] {
  const byName = new Map<string, PrReviewer['state']>();
  for (const r of nodes(p.latestReviews)) {
    const name = login(r.author);
    const state = REVIEW_STATES[str(r.state)];
    if (name && state) byName.set(name, state);
  }
  for (const r of nodes(p.reviewRequests)) {
    const who = (r.requestedReviewer ?? {}) as Node;
    const name = str(who.login) || str(who.name);
    if (name) byName.set(name, 'pending');
  }
  return [...byName].map(([name, state]) => ({ name, state }));
}

/** The head commit's check runs and statuses. */
function checksFrom(p: Node): PrCheck[] {
  const commit = nodes(p.commits)[0]?.commit as Node | undefined;
  const rollup = commit?.statusCheckRollup as Node | null | undefined;
  return githubChecks(nodes(rollup?.contexts));
}

/** The ForgeReview of PR_REVIEW_QUERY's `pullRequest` node, given the commits its diff spans. */
export function githubReviewFrom(
  pr: unknown,
  { number, base, head, viewer }: { number: number; base: string; head: string; viewer: string },
): ForgeReview {
  const p = (pr && typeof pr === 'object' ? pr : {}) as Node;
  const viewerIsAuthor = p.viewerDidAuthor === true;
  // A request goes away once the person reviews. A team's request isn't
  // matched: that would take a lookup of the viewer's teams.
  const viewerIsRequestedReviewer =
    !!viewer &&
    nodes(p.reviewRequests).some(
      (r) => str((r.requestedReviewer as Node | null)?.login) === viewer,
    );
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
    body: str(p.body),
    url: str(p.url),
    viewerIsAuthor,
    viewerIsRequestedReviewer,
    verdicts: viewerIsAuthor ? ['comment'] : GITHUB_VERDICTS,
    base,
    head,
    threads: nodes(p.reviewThreads).map(threadFrom),
    conversation,
    ...(threads?.pageInfo?.hasNextPage === true ? { partial: true } : {}),
    author: login(p.author) || 'ghost',
    state: stateFrom(p),
    baseRef: str(p.baseRefName),
    headRef: str(p.headRefName),
    reviewers: reviewersFrom(p),
    assignees: nodes(p.assignees).map(login).filter(Boolean),
    checks: checksFrom(p),
  };
}

/** Runs a GraphQL call through `gh` in `cwd` and returns its `data`. Strings go
 *  as raw fields (`-f`); numbers, booleans and the `{owner}` / `{repo}`
 *  placeholders as typed ones (`-F`), which gh fills from the checkout's repo. */
export type Gql = (
  cwd: string,
  query: string,
  vars: Record<string, string | number | boolean>,
) => Promise<Node>;

/** Runs `gh` in `cwd` and returns its parsed JSON output; a failure throws with gh's message. */
async function gh(cwd: string, args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(stdout) as unknown;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error([e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim());
  }
}

export const ghGql: Gql = async (cwd, query, vars) => {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) {
    const typed = typeof v !== 'string' || /^\{(owner|repo)\}$/.test(v);
    args.push(typed ? '-F' : '-f', `${k}=${v}`);
  }
  return ((await gh(cwd, args)) as { data?: Node } | null)?.data ?? {};
};

/** Runs a REST call through `gh api` in `cwd` and returns its parsed body. gh
 *  fills `{owner}` / `{repo}` in the path from the checkout's repo; `fields`
 *  go as raw strings (`-f`). */
export type Rest = (
  cwd: string,
  method: 'POST',
  path: string,
  fields: Record<string, string>,
) => Promise<unknown>;

export const ghRest: Rest = (cwd, method, path, fields) =>
  gh(cwd, [
    'api',
    '-X',
    method,
    path,
    ...Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`]),
  ]);

const repoVars = (number: number) => ({ owner: '{owner}', name: '{repo}', number });

/** The PrWriteError for a failed GitHub write. */
export function githubWriteError(err: unknown): PrWriteError {
  const message = err instanceof Error ? err.message : String(err);
  if (
    /required scopes|Resource not accessible by (integration|personal access token)|INSUFFICIENT_SCOPES/i.test(
      message,
    )
  ) {
    return { kind: 'scope', fix: 'gh auth refresh -s repo' };
  }
  return { kind: 'other', message: message.split('\n').find((l) => l.trim()) ?? 'unknown error' };
}

const EVENTS: Partial<Record<PrVerdict, string>> = {
  comment: 'COMMENT',
  approve: 'APPROVE',
  request_changes: 'REQUEST_CHANGES',
};

const PR_ID_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id reviews(states: PENDING, first: 1) { nodes { id } } }
  }
}`;
const ADD_REVIEW = `mutation($pr: ID!) {
  addPullRequestReview(input: { pullRequestId: $pr }) { pullRequestReview { id } }
}`;
const addThread = (
  range: boolean,
) => `mutation($review: ID!, $path: String!, $line: Int!, $body: String!${
  range ? ', $startLine: Int!' : ''
}) {
  addPullRequestReviewThread(input: {
    pullRequestReviewId: $review, path: $path, line: $line, side: RIGHT, body: $body${
      range ? ', startLine: $startLine, startSide: RIGHT' : ''
    }
  }) { thread { id } }
}`;
const ADD_REPLY = `mutation($review: ID!, $thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body
  }) { comment { id } }
}`;
const SUBMIT_REVIEW = `mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String!) {
  submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) {
    pullRequestReview { id }
  }
}`;
const DELETE_REVIEW = `mutation($review: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $review }) { pullRequestReview { id } }
}`;
const resolveMutation = (resolved: boolean) =>
  `mutation($id: ID!) { ${resolved ? 'resolveReviewThread' : 'unresolveReviewThread'}(input: { threadId: $id }) { thread { id } } }`;

/** The first comment of a review thread, by its REST id (what a reply hangs off). */
const THREAD_ROOT_QUERY = `query($thread: ID!) {
  node(id: $thread) { ... on PullRequestReviewThread { comments(first: 1) { nodes { databaseId } } } }
}`;

/**
 * A reply that posts at once, outside any review: REST "Create a reply for a
 * review comment" (https://docs.github.com/en/rest/pulls/comments#create-a-reply-for-a-review-comment),
 * which takes the thread's top-level comment. Not GraphQL's
 * addPullRequestReviewThreadReply: without a review id it isn't documented to
 * stay out of the viewer's pending review.
 */
export const githubReplyRequest = (number: number, rootCommentId: number, body: string) => ({
  method: 'POST' as const,
  path: `repos/{owner}/{repo}/pulls/${number}/comments/${rootCommentId}/replies`,
  fields: { body },
});

/** The PrReviewComment of a REST review comment (ids are GraphQL node ids, as `load`'s are). */
export function restCommentFrom(c: unknown): PrReviewComment {
  const r = (c && typeof c === 'object' ? c : {}) as Node;
  return {
    id: str(r.node_id),
    author: login(r.user) || 'ghost',
    body: str(r.body),
    createdAt: str(r.created_at),
    url: str(r.html_url),
  };
}

const pick = (data: Node, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Node)[k] : undefined), data);

/** The GitHub adapter, over a GraphQL transport (the real one runs `gh`). */
export function makeGithubProvider(gql: Gql = ghGql, rest: Rest = ghRest): PrReviewProvider {
  return {
    list: (ctx) => GithubService.listPullRequests(ctx.cwd),

    async load(ctx, number) {
      const data = await gql(ctx.cwd, PR_REVIEW_QUERY, repoVars(number));
      const pr = pick(data, 'repository', 'pullRequest') as Node | undefined;
      if (!pr) throw new Error(`PR #${number} not found`);
      const head = str(pr.headRefOid);
      const baseTip = str(pr.baseRefOid);
      await ensureCommits(ctx.cwd, [baseTip, head]);
      const base = (await runGit(ctx.cwd, ['merge-base', baseTip, head], TIMEOUT_MS)).trim();
      const viewer = str(pick(data, 'viewer', 'login'));
      return { ...githubReviewFrom(pr, { number, base, head, viewer }), baseTip };
    },

    async reply(ctx, number, threadId, body) {
      const data = await gql(ctx.cwd, THREAD_ROOT_QUERY, { thread: threadId });
      const root = num(nodes(pick(data, 'node', 'comments'))[0]?.databaseId);
      if (root === null) throw new Error('The thread has no comment to reply to');
      const req = githubReplyRequest(number, root, body);
      return restCommentFrom(await rest(ctx.cwd, req.method, req.path, req.fields));
    },

    async setResolved(ctx, _number, threadId, resolved) {
      await gql(ctx.cwd, resolveMutation(resolved), { id: threadId });
    },

    /**
     * All or nothing: the comments and replies go into one pending review that
     * is submitted with the verdict, and deleted again if any step fails.
     */
    async submit(ctx, number, s) {
      const event = EVENTS[s.verdict];
      if (!event)
        return {
          postedDraftIds: [],
          error: { kind: 'other', message: `GitHub has no "${s.verdict}" verdict` },
        };
      if (
        s.comments.length === 0 &&
        s.replies.length === 0 &&
        !s.body.trim() &&
        s.verdict === 'comment'
      ) {
        return { postedDraftIds: [], error: { kind: 'other', message: 'Nothing to submit' } };
      }
      let reviewId: string | null = null;
      try {
        const data = await gql(ctx.cwd, PR_ID_QUERY, repoVars(number));
        const pr = pick(data, 'repository', 'pullRequest') as Node | undefined;
        if (!pr) throw new Error(`PR #${number} not found`);
        if (nodes(pr.reviews).length > 0)
          return { postedDraftIds: [], error: { kind: 'pending-review' } };

        const added = await gql(ctx.cwd, ADD_REVIEW, { pr: str(pr.id) });
        reviewId = str(pick(added, 'addPullRequestReview', 'pullRequestReview', 'id'));
        if (!reviewId) throw new Error('GitHub did not return the new review');
        for (const c of s.comments) {
          const range = c.startLine < c.endLine;
          await gql(ctx.cwd, addThread(range), {
            review: reviewId,
            path: c.path,
            line: c.endLine,
            body: c.body,
            ...(range ? { startLine: c.startLine } : {}),
          });
        }
        for (const r of s.replies) {
          await gql(ctx.cwd, ADD_REPLY, { review: reviewId, thread: r.threadId, body: r.body });
        }
        await gql(ctx.cwd, SUBMIT_REVIEW, { review: reviewId, event, body: s.body });
        return {
          postedDraftIds: [...s.comments.map((c) => c.draftId), ...s.replies.map((r) => r.draftId)],
        };
      } catch (err) {
        if (reviewId) {
          await gql(ctx.cwd, DELETE_REVIEW, { review: reviewId }).catch((e: unknown) =>
            console.warn('[prReview] could not delete the pending review', e),
          );
        }
        return { postedDraftIds: [], error: githubWriteError(err) };
      }
    },
  };
}

export const githubProvider: PrReviewProvider = makeGithubProvider();
