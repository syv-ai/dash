import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  PrReview,
  PrReviewComment,
  PrReviewThread,
  PrVerdict,
  PrWriteError,
} from '@shared/types';
import { GithubService } from '../GithubService';
import { ensureCommits, runGit } from './localCommits';
import type { PrReviewProvider } from './types';

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
      reviewRequests(first: 100) { nodes { requestedReviewer { ... on User { login } } } }
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
  { number, base, head, viewer }: { number: number; base: string; head: string; viewer: string },
): PrReview {
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

export const ghGql: Gql = async (cwd, query, vars) => {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) {
    const typed = typeof v !== 'string' || /^\{(owner|repo)\}$/.test(v);
    args.push(typed ? '-F' : '-f', `${k}=${v}`);
  }
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
      maxBuffer: 16 * 1024 * 1024,
    });
    return (JSON.parse(stdout)?.data ?? {}) as Node;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error([e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim());
  }
};

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

const HEAD_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid } }
}`;

/** A page of a PR's review threads, with their comments' ids (a reply names the first). */
const THREAD_IDS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id comments(first: 50) { nodes { id databaseId } } }
      }
    }
  }
}`;

/** Whether `ref` is the thread's id, or one of its comments' node or REST ids. */
const threadMatches = (t: Node, ref: string) =>
  t.id === ref ||
  nodes(t.comments).some(
    (c) => c.id === ref || (typeof c.databaseId === 'number' && String(c.databaseId) === ref),
  );

/** Runs one step of a submit, naming the draft it was posting (its text, which the
 *  person recognises) when it fails. */
async function posting(what: string, body: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (err) {
    const text = body.replace(/\s+/g, ' ').trim();
    const quote = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    throw new Error(`${what} ("${quote}"): ${err instanceof Error ? err.message : String(err)}`);
  }
}

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

const pick = (data: Node, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Node)[k] : undefined), data);

/** The GitHub adapter, over a GraphQL transport (the real one runs `gh`). */
export function makeGithubProvider(gql: Gql = ghGql): PrReviewProvider {
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
      return githubReviewFrom(pr, { number, base, head, viewer });
    },

    async setResolved(ctx, _number, threadId, resolved) {
      await gql(ctx.cwd, resolveMutation(resolved), { id: threadId });
    },

    async head(ctx, number) {
      const data = await gql(ctx.cwd, HEAD_QUERY, repoVars(number));
      const head = str(pick(data, 'repository', 'pullRequest', 'headRefOid'));
      if (!head) throw new Error(`PR #${number} not found`);
      return head;
    },

    async replyThread(ctx, number, ref) {
      // Page through: a PR can have more threads than one page holds.
      for (let after = ''; ; ) {
        const vars = { ...repoVars(number), ...(after ? { after } : {}) };
        const data = await gql(ctx.cwd, THREAD_IDS_QUERY, vars);
        const pr = pick(data, 'repository', 'pullRequest') as Node | undefined;
        if (!pr) throw new Error(`PR #${number} not found`);
        const thread = nodes(pr.reviewThreads).find((t) => threadMatches(t, ref));
        if (thread) return str(thread.id);
        const page = pick(pr, 'reviewThreads', 'pageInfo') as Node | undefined;
        after = page?.hasNextPage === true ? str(page.endCursor) : '';
        if (!after) return null;
      }
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
        const review = reviewId;
        for (const c of s.comments) {
          const range = c.startLine < c.endLine;
          await posting(`comment on ${c.path}:${c.startLine}`, c.body, () =>
            gql(ctx.cwd, addThread(range), {
              review,
              path: c.path,
              line: c.endLine,
              body: c.body,
              ...(range ? { startLine: c.startLine } : {}),
            }),
          );
        }
        for (const r of s.replies) {
          await posting(`reply to thread ${r.threadId}`, r.body, () =>
            gql(ctx.cwd, ADD_REPLY, { review, thread: r.threadId, body: r.body }),
          );
        }
        await gql(ctx.cwd, SUBMIT_REVIEW, { review, event, body: s.body });
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
