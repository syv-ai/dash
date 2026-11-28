import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  CiState,
  PrCheck,
  PrReaction,
  PrReactionContent,
  PrListFilter,
  PrReviewComment,
  PrReviewer,
  PrViewerReview,
  PrReviewThread,
  PrState,
  PrVerdict,
  PrWriteError,
  RelevantPr,
} from '@shared/types';
import { GITHUB_REACTIONS } from '@shared/prReactions';
import { quoteReply, type GeneralReplyTarget } from '@shared/prGeneralReply';
import { FORGE_CAPABILITIES } from '@shared/forgeCapabilities';
import { githubChecks } from '../prRelevance';
import { GithubService } from '../GithubService';
import { ensureCommits, runGit } from './localCommits';
import type { ForgeReview, ForgeProvider } from './types';

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
      createdAt
      updatedAt
      author { login url }
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
          comments(first: 50) {
            nodes { id author { login url } body createdAt url reactionGroups { content viewerHasReacted reactors { totalCount } } }
          }
        }
      }
      comments(first: 100) {
        nodes { id author { login url } body createdAt url reactionGroups { content viewerHasReacted reactors { totalCount } } }
      }
      reviews(first: 100) {
        nodes { id author { login url } body state createdAt submittedAt commit { oid } url reactionGroups { content viewerHasReacted reactors { totalCount } } }
      }
      reviewRequests(first: 100) {
        nodes { requestedReviewer { ... on User { login url } ... on Team { name url } } }
      }
      latestReviews(first: 100) { nodes { author { login url } state } }
      latestOpinionatedReviews(first: 100) { nodes { author { login url } state } }
      assignees(first: 50) { nodes { login } }
      closingIssuesReferences(first: 25) { nodes { number title url } }
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

/** The open PRs from (`$head`) or into (`$base`) a branch, newest first, with
 *  what the PR button shows of each. One call per listing, like `gh pr list`,
 *  which can't count review threads. */
export const RELEVANT_PRS_QUERY = `query($owner: String!, $name: String!, $head: String, $base: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      states: OPEN
      headRefName: $head
      baseRefName: $base
      first: 50
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        number title url state isDraft isCrossRepository
        headRefName baseRefName updatedAt additions deletions
        author { login }
        reviewThreads(first: 100) { totalCount nodes { isResolved } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const login = (v: unknown): string => str((v as { login?: unknown } | null)?.login);
/** A user's or team's page on GitHub; null when the node has none. */
const profileUrl = (v: unknown): string | null => str((v as { url?: unknown } | null)?.url) || null;
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const nodes = (v: unknown): Node[] => {
  const list = (v as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(list) ? list.filter((n): n is Node => !!n && typeof n === 'object') : [];
};

const pick = (data: Node, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Node)[k] : undefined), data);

/** A comment's reaction groups, those someone gave (GitHub lists all eight). */
export function reactionsFrom(groups: unknown): PrReaction[] {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g: Node | null): PrReaction[] => {
    const content = str(g?.content) as PrReactionContent;
    const count = num(pick(g ?? {}, 'reactors', 'totalCount')) ?? 0;
    if (!GITHUB_REACTIONS.includes(content) || count <= 0) return [];
    return [{ content, count, viewerReacted: g?.viewerHasReacted === true }];
  });
}

function commentFrom(c: Node): PrReviewComment {
  return {
    id: str(c.id),
    // A deleted account comes back without an author, as GitHub's "ghost".
    author: login(c.author) || 'ghost',
    authorUrl: profileUrl(c.author),
    body: str(c.body),
    createdAt: str(c.createdAt),
    url: str(c.url),
    reactions: reactionsFrom(c.reactionGroups),
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

/** A status check rollup's state as one CI state; null without checks. */
const ROLLUP_CI: Record<string, CiState> = {
  SUCCESS: 'passing',
  FAILURE: 'failing',
  ERROR: 'failing',
  PENDING: 'pending',
  EXPECTED: 'pending',
};

/** The listed PRs of a RELEVANT_PRS_QUERY answer. */
export function githubRelevantPrsFrom(data: Node): RelevantPr[] {
  return nodes(pick(data, 'repository', 'pullRequests')).map((p) => {
    const threads = nodes(p.reviewThreads);
    const total = num(pick(p, 'reviewThreads', 'totalCount')) ?? threads.length;
    const rollup = nodes(p.commits)[0];
    const state = stateFrom(p);
    return {
      number: num(p.number) ?? 0,
      title: str(p.title),
      url: str(p.url),
      state: state === 'draft' ? 'open' : state,
      draft: state === 'draft',
      author: login(p.author),
      headRefName: str(p.headRefName),
      baseRefName: str(p.baseRefName),
      provider: 'github' as const,
      fromFork: p.isCrossRepository === true,
      updatedAt: str(p.updatedAt) || null,
      additions: num(p.additions),
      deletions: num(p.deletions),
      threads: { open: threads.filter((t) => t.isResolved !== true).length, total },
      ci: ROLLUP_CI[str(pick(rollup ?? {}, 'commit', 'statusCheckRollup', 'state'))] ?? null,
    };
  });
}

/** RELEVANT_PRS_QUERY's variables for `filter`; an unset side isn't sent. */
function listVars(filter: PrListFilter = {}): Record<string, string> {
  return {
    owner: '{owner}',
    name: '{repo}',
    ...(filter.head ? { head: filter.head } : {}),
    ...(filter.base ? { base: filter.base } : {}),
  };
}

const REVIEW_STATES: Record<string, PrViewerReview['state']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
};

/** Each reviewer's latest review, overridden by their latest approval or
 *  change request (a later plain comment doesn't undo it), then the pending
 *  requests: a re-request outranks the review before it, as on GitHub.
 *  Dismissed reviews don't count. */
function reviewersFrom(p: Node): PrReviewer[] {
  const byName = new Map<string, PrReviewer>();
  for (const r of [...nodes(p.latestReviews), ...nodes(p.latestOpinionatedReviews)]) {
    const name = login(r.author);
    const state = REVIEW_STATES[str(r.state)];
    if (name && state) byName.set(name, { name, url: profileUrl(r.author), state });
  }
  for (const r of nodes(p.reviewRequests)) {
    const who = r.requestedReviewer;
    const team = !login(who);
    const name = login(who) || str((who as Node | null)?.name);
    if (name)
      byName.set(name, {
        name,
        url: profileUrl(who),
        state: 'pending',
        ...(team ? { group: true as const } : {}),
      });
  }
  return [...byName.values()];
}

/** The viewer's latest submitted review (dismissed and pending ones don't
 *  count), its verdict kept through a later plain comment as `reviewersFrom`
 *  keeps it; stale once the PR's head has moved past the commit it reviewed. */
export function githubViewerReview(p: Node, viewer: string): PrViewerReview | null {
  if (!viewer) return null;
  const mine = nodes(p.reviews).filter(
    (r) => login(r.author) === viewer && REVIEW_STATES[str(r.state)],
  );
  const last = mine[mine.length - 1];
  if (!last) return null;
  const verdict = [...mine]
    .reverse()
    .find((r) => r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED');
  const reviewed = str((last.commit as Node | null)?.oid);
  const head = str(p.headRefOid);
  return {
    state: REVIEW_STATES[str((verdict ?? last).state)]!,
    at: str(last.submittedAt) || str(last.createdAt),
    stale: !!reviewed && !!head && reviewed !== head,
  };
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
  const assignees = nodes(p.assignees).map(login).filter(Boolean);
  // Any comment of the viewer's: in the conversation, a submitted review, or a thread.
  const viewerCommented =
    !!viewer &&
    [
      ...nodes(p.comments),
      ...nodes(p.reviews).filter((r) => r.state !== 'PENDING'),
      ...nodes(p.reviewThreads).flatMap((t) => nodes(t.comments)),
    ].some((c) => login(c.author) === viewer);
  return {
    provider: 'github',
    number,
    title: str(p.title),
    body: str(p.body),
    url: str(p.url),
    viewerIsAuthor,
    viewerIsRequestedReviewer,
    viewerIsAssignee: !!viewer && assignees.includes(viewer),
    viewerName: viewer || null,
    viewerCommented,
    verdicts: viewerIsAuthor ? ['comment'] : GITHUB_VERDICTS,
    base,
    head,
    threads: nodes(p.reviewThreads).map(threadFrom),
    conversation,
    ...(threads?.pageInfo?.hasNextPage === true ? { partial: true } : {}),
    author: login(p.author) || 'ghost',
    authorUrl: profileUrl(p.author),
    createdAt: str(p.createdAt),
    lastActivityAt: str(p.updatedAt) || str(p.createdAt),
    state: stateFrom(p),
    baseRef: str(p.baseRefName),
    headRef: str(p.headRefName),
    reviewers: reviewersFrom(p),
    viewerReview: githubViewerReview(p, viewer),
    assignees,
    issues: nodes(p.closingIssuesReferences).flatMap((i) => {
      const n = num(i.number);
      return n === null ? [] : [{ number: n, title: str(i.title), url: str(i.url) }];
    }),
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

/**
 * A reply to a general comment, posted at once: GitHub's PR conversation
 * isn't threaded, so it is a new PR (issue) comment quoting the original and
 * mentioning its author (`quoteReply`), as GitHub's own "Quote reply" does.
 * REST "Create an issue comment"
 * (https://docs.github.com/en/rest/issues/comments#create-an-issue-comment).
 */
export const githubGeneralReplyRequest = (
  number: number,
  to: GeneralReplyTarget,
  text: string,
) => ({
  method: 'POST' as const,
  path: `repos/{owner}/{repo}/issues/${number}/comments`,
  fields: { body: quoteReply(to, text) },
});

/** The PrReviewComment of a REST review or issue comment (ids are GraphQL node ids, as `load`'s are). */
export function restCommentFrom(c: unknown): PrReviewComment {
  const r = (c && typeof c === 'object' ? c : {}) as Node;
  return {
    id: str(r.node_id),
    author: login(r.user) || 'ghost',
    authorUrl: str((r.user as Node | null)?.html_url) || null,
    body: str(r.body),
    createdAt: str(r.created_at),
    url: str(r.html_url),
    reactions: [],
  };
}

/** Give (`on`) or take back the viewer's reaction on a comment, issue
 *  comment or review: `addReaction` / `removeReaction` on its node id. */
export const githubReactionRequest = (
  subjectId: string,
  content: PrReactionContent,
  on: boolean,
) => ({
  query: `mutation($subject: ID!, $content: ReactionContent!) {
  ${on ? 'addReaction' : 'removeReaction'}(input: { subjectId: $subject, content: $content }) {
    reaction { content }
  }
}`,
  vars: { subject: subjectId, content },
});

/** The GitHub adapter, over a GraphQL transport (the real one runs `gh`). */
export function makeGithubProvider(gql: Gql = ghGql, rest: Rest = ghRest): ForgeProvider {
  return {
    capabilities: FORGE_CAPABILITIES.github,

    prsFrom: (ctx, branch) => GithubService.getPullRequestsFrom(ctx.cwd, branch),

    listOpen: (ctx) => GithubService.listPullRequests(ctx.cwd),

    prepareBranch: (ctx, pr) =>
      GithubService.fetchPullRequestHead(ctx.cwd, pr.number, pr.headRefName),

    failedChecks: (ctx, number) => GithubService.getFailedChecks(ctx.cwd, number),

    commitAuthorUrl: (cwd, sha) => GithubService.commitAuthorUrl(cwd, sha),

    list: async (ctx, filter) =>
      githubRelevantPrsFrom(await gql(ctx.cwd, RELEVANT_PRS_QUERY, listVars(filter))),

    async load(ctx, number) {
      const data = await gql(ctx.cwd, PR_REVIEW_QUERY, repoVars(number));
      const pr = pick(data, 'repository', 'pullRequest') as Node | undefined;
      if (!pr) throw new Error(`PR #${number} not found`);
      const head = str(pr.headRefOid);
      const baseTip = str(pr.baseRefOid);
      await ensureCommits(ctx.cwd, [baseTip, head], undefined, [`refs/pull/${number}/head`]);
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

    async replyGeneral(ctx, number, to, body) {
      const req = githubGeneralReplyRequest(number, to, body);
      return restCommentFrom(await rest(ctx.cwd, req.method, req.path, req.fields));
    },

    async setResolved(ctx, _number, threadId, resolved) {
      await gql(ctx.cwd, resolveMutation(resolved), { id: threadId });
    },

    async react(ctx, _number, commentId, content, on) {
      if (content === 'LIKE') throw new Error('GitHub has no "like" reaction');
      const req = githubReactionRequest(commentId, content, on);
      await gql(ctx.cwd, req.query, req.vars);
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

export const githubProvider: ForgeProvider = makeGithubProvider();
