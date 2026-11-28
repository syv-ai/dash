import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  PrCheck,
  PullRequestInfo,
  PrIssue,
  PrReaction,
  PrReactionContent,
  PrReviewComment,
  PrReviewer,
  PrViewerReview,
  PrReviewThread,
  PrState,
  PrVerdict,
  PrWriteError,
  RelevantPr,
} from '@shared/types';
import {
  AdoRequestError,
  AzureDevOpsService,
  adoProjectSegment,
  adoRequest,
} from '../AzureDevOpsService';
import { FORGE_CAPABILITIES } from '@shared/forgeCapabilities';
import { adoPrListQuery, mapAdoPrList, mapAdoRelevantPrs } from '../adoPr';
import type { FailedCheck } from '../ciReport';
import { adoBuildIdOf, adoLogExcerpt, adoLogStartLine, adoTimelineFailure } from '../adoCi';
import { ciOf } from '../prRelevance';
import { ensureCommits, filesAtCommit, localDiffStat, runGit } from './localCommits';
import type { ForgeReview, PrContext, ForgeProvider } from './types';

const execFileAsync = promisify(execFile);

// ── Mapping (pure) ──────────────────────────────────────────

interface RawPosition {
  line?: number;
  offset?: number;
}
interface RawComment {
  id?: number;
  parentCommentId?: number;
  content?: string;
  commentType?: string;
  isDeleted?: boolean;
  publishedDate?: string;
  lastUpdatedDate?: string;
  author?: { id?: string; displayName?: string } | null;
  /** Who liked it (ADO's one reaction). */
  usersLiked?: { id?: string }[] | null;
}
interface RawThread {
  id?: number;
  lastUpdatedDate?: string;
  status?: string | null;
  isDeleted?: boolean;
  properties?: Record<string, unknown> | null;
  threadContext?: {
    filePath?: string;
    rightFileStart?: RawPosition | null;
    rightFileEnd?: RawPosition | null;
    leftFileStart?: RawPosition | null;
    leftFileEnd?: RawPosition | null;
  } | null;
  /** Where the thread was left (its iteration) and, once ADO tracked it onto
   *  a later one, where it was then (`trackingCriteria`'s orig* fields). */
  pullRequestThreadContext?: {
    iterationContext?: { firstComparingIteration?: number; secondComparingIteration?: number };
    trackingCriteria?: {
      origFilePath?: string;
      origRightFileStart?: RawPosition | null;
      origRightFileEnd?: RawPosition | null;
    } | null;
  } | null;
  comments?: RawComment[];
}
interface RawIteration {
  id?: number;
  createdDate?: string;
  updatedDate?: string;
  sourceRefCommit?: { commitId?: string };
  commonRefCommit?: { commitId?: string };
}
interface RawPr {
  pullRequestId?: number;
  title?: string;
  description?: string;
  status?: string;
  isDraft?: boolean;
  creationDate?: string;
  closedDate?: string;
  sourceRefName?: string;
  targetRefName?: string;
  createdBy?: { id?: string; displayName?: string } | null;
  reviewers?:
    | {
        id?: string;
        displayName?: string;
        vote?: number;
        isRequired?: boolean;
        hasDeclined?: boolean;
        /** A group (deprecated in the docs, still sent). */
        isContainer?: boolean;
      }[]
    | null;
  repository?: { project?: { id?: string } } | null;
  /** The target branch's tip ADO last merged the PR against. */
  lastMergeTargetCommit?: { commitId?: string } | null;
  /** The PR's head when ADO last merged it: its last pushed commit. */
  lastMergeSourceCommit?: { commitId?: string } | null;
}

export interface AdoRepoContext {
  organizationUrl: string;
  project: string;
  repository: string;
}

const RESOLVED = new Set(['fixed', 'wontFix', 'closed', 'byDesign']);
const ADO_VERDICTS: PrVerdict[] = [
  'comment',
  'approve',
  'approve_with_suggestions',
  'wait_for_author',
  'reject',
];

const list = <T>(v: unknown): T[] =>
  Array.isArray(v)
    ? v
    : Array.isArray((v as { value?: unknown })?.value)
      ? (v as { value: T[] }).value
      : [];

/** The latest iteration: the diff ADO shows, and the one threads are tracked onto. */
export function latestIteration(iterations: unknown): {
  id: number;
  head: string;
  base: string;
} {
  const its = list<RawIteration>(iterations).filter((i) => typeof i.id === 'number');
  if (its.length === 0) throw new Error('The pull request has no iterations');
  const last = its.reduce((a, b) => (b.id! > a.id! ? b : a));
  return {
    id: last.id!,
    head: last.sourceRefCommit?.commitId ?? '',
    base: last.commonRefCommit?.commitId ?? '',
  };
}

const prUrl = (ctx: AdoRepoContext, id: number) =>
  `${ctx.organizationUrl.replace(/\/+$/, '')}/${ctx.project}/_git/${ctx.repository}/pullrequest/${id}`;

/** The newest of `dates` (ISO 8601), as given; '' when none parses. */
export function newestDate(dates: readonly (string | null | undefined)[]): string {
  let best = '';
  let bestAt = -Infinity;
  for (const d of dates) {
    const at = d ? Date.parse(d) : NaN;
    if (at > bestAt) [best, bestAt] = [d!, at];
  }
  return best;
}

/** ADO keeps no "updated" date on a PR: its latest activity is the newest of
 *  its creation and close, its iterations (pushes) and every thread and
 *  comment, ADO's own (votes, reviewer changes) included. */
function lastActivity(pr: RawPr, iterations: unknown, threads: unknown): string {
  return newestDate([
    pr.creationDate,
    pr.closedDate,
    ...list<RawIteration>(iterations).flatMap((i) => [i.createdDate, i.updatedDate]),
    ...list<RawThread>(threads).flatMap((t) => [
      t.lastUpdatedDate,
      ...(t.comments ?? []).flatMap((c) => [c.publishedDate, c.lastUpdatedDate]),
    ]),
  ]);
}

const branchName = (ref: string | undefined) => (ref ?? '').replace(/^refs\/heads\//, '');

function stateFrom(pr: RawPr): PrState {
  if (pr.status === 'completed') return 'merged';
  if (pr.status === 'abandoned') return 'closed';
  return pr.isDraft ? 'draft' : 'open';
}

/** A `git/pullrequests` entry as a branch's PR (see `ForgeProvider.prsFrom`),
 *  with `ci` the open PR's checks as one state. */
export function adoBranchPrFrom(
  raw: unknown,
  ctx: AdoRepoContext,
  ci: PullRequestInfo['ci'] = null,
): PullRequestInfo {
  const pr = (raw ?? {}) as RawPr;
  const state = stateFrom(pr);
  const number = pr.pullRequestId ?? 0;
  return {
    number,
    title: pr.title ?? '',
    url: prUrl(ctx, number),
    state: state === 'draft' ? 'open' : state,
    provider: 'ado',
    headSha: pr.lastMergeSourceCommit?.commitId,
    ci: state === 'merged' || state === 'closed' ? null : ci,
  };
}

// A reviewer's vote: 10 approved, 5 with suggestions, 0 none yet, -5 waiting, -10 rejected.
const VOTE_STATES: Record<number, PrViewerReview['state']> = {
  10: 'approved',
  5: 'approved_with_suggestions',
  [-5]: 'waiting',
  [-10]: 'rejected',
};

const reviewersFrom = (pr: RawPr): PrReviewer[] =>
  (pr.reviewers ?? []).map((r) => ({
    name: r.displayName || 'Unknown',
    url: null,
    state: VOTE_STATES[r.vote ?? 0] ?? 'pending',
    ...(r.isRequired ? { required: true as const } : {}),
    ...(r.hasDeclined ? { declined: true as const } : {}),
    ...(r.isContainer ? { group: true as const } : {}),
  }));

/**
 * The viewer's vote, if they cast one, as their review: when is the newest
 * vote ADO wrote down for them (its VoteUpdate threads), and it is stale
 * once a push (an iteration) came after it. ADO may reset votes on a push,
 * leaving none.
 */
export function adoViewerReview(
  pr: RawPr,
  iterations: unknown,
  threads: unknown,
  me: string,
): PrViewerReview | null {
  const vote = me ? (pr.reviewers ?? []).find((r) => r.id === me)?.vote : undefined;
  const state = vote ? VOTE_STATES[vote] : undefined;
  if (!state) return null;
  const at = list<RawThread>(threads)
    .filter((t) => threadType(t) === 'VoteUpdate')
    .flatMap((t) => t.comments ?? [])
    .filter((c) => c.author?.id === me && c.publishedDate)
    .map((c) => c.publishedDate!)
    .sort()
    .pop();
  const stale =
    !!at && list<RawIteration>(iterations).some((i) => !!i.createdDate && i.createdDate > at);
  return { state, at: at ?? '', stale };
}

/** A thread's `CodeReviewThreadType` (VoteUpdate, RefUpdate, …); '' for a person's. */
function threadType(t: RawThread): string {
  const v = t.properties?.CodeReviewThreadType;
  if (typeof v === 'string') return v;
  const inner = (v as { $value?: unknown } | null | undefined)?.$value;
  return typeof inner === 'string' ? inner : '';
}

/** A comment's likes as its one reaction; none when no one liked it. `me`
 *  is the viewer's identity id ('' when unknown). */
export function adoLikes(c: Pick<RawComment, 'usersLiked'>, me: string): PrReaction[] {
  const users = (c.usersLiked ?? []).filter((u) => !!u);
  if (users.length === 0) return [];
  return [
    { content: 'LIKE', count: users.length, viewerReacted: !!me && users.some((u) => u.id === me) },
  ];
}

/** One person's comment of thread `tid`, linked to where ADO shows the thread. */
const commentFrom = (c: RawComment, tid: string, threadUrl: string, me = ''): PrReviewComment => ({
  id: `${tid}:${c.id ?? ''}`,
  author: c.author?.displayName || 'Unknown',
  // ADO has no profile page to link a person to.
  authorUrl: null,
  body: c.content ?? '',
  createdAt: c.publishedDate ?? '',
  url: threadUrl,
  reactions: adoLikes(c, me),
});

const threadUrl = (url: string, t: RawThread) =>
  `${url}?_a=${t.threadContext ? 'files' : 'overview'}&discussionId=${t.id ?? ''}`;

/** The comment a reply hangs off: the thread's first (ADO's replies are flat under it). */
export function adoRootCommentId(thread: unknown): number {
  const comments = ((thread as RawThread | null)?.comments ?? []).filter(
    (c) => typeof c.id === 'number',
  );
  const roots = comments.filter((c) => !c.parentCommentId);
  const ids = (roots.length > 0 ? roots : comments).map((c) => c.id!);
  if (ids.length === 0) throw new Error('The thread has no comment to reply to');
  return Math.min(...ids);
}

/** A person's thread, not one ADO writes about pushes, votes, reviewers or policies. */
const isHumanThread = (t: RawThread) =>
  !t.isDeleted &&
  !t.properties?.CodeReviewThreadType &&
  (t.comments ?? []).some((c) => c.commentType !== 'system' && !c.isDeleted);

/** A listed PR's row facts from its threads (`pullRequests/{id}/threads`):
 *  its people's threads, open and all, and its latest activity, the newest
 *  of its creation and every thread and comment (ADO's own push and vote
 *  threads included, so a push counts). */
export function adoRowFacts(
  pr: unknown,
  threads: unknown,
): { updatedAt: string | null; threads: { open: number; total: number } } {
  const human = list<RawThread>(threads).filter(isHumanThread);
  return {
    updatedAt: lastActivity((pr ?? {}) as RawPr, [], threads) || null,
    threads: {
      open: human.filter((t) => !RESOLVED.has(t.status ?? '')).length,
      total: human.length,
    },
  };
}

/** Where a thread on the PR's side was left, when that was before the latest
 *  iteration: the commit it was left on, and its path and lines there. */
export interface ThreadOrigin {
  threadId: string;
  commit: string;
  /** Its path in `commit`, and at head (they differ once the file moved). */
  path: string;
  headPath: string;
  start: number;
  end: number;
}

/**
 * The origins of the threads left on the PR's (right) side of an earlier
 * iteration than `latest`: the iteration's head commit, and the thread's
 * place in it (ADO's `trackingCriteria` once it tracked the thread on, else
 * its context as left). A thread whose iteration isn't listed is left out.
 */
export function adoThreadOrigins(
  threads: unknown,
  iterations: unknown,
  latest: number,
): ThreadOrigin[] {
  const commits = new Map(
    list<RawIteration>(iterations).map((i) => [i.id, i.sourceRefCommit?.commitId ?? '']),
  );
  return list<RawThread>(threads).flatMap((t) => {
    const where = t.threadContext;
    const left = t.pullRequestThreadContext?.iterationContext?.secondComparingIteration;
    if (!where?.rightFileStart || !left || left >= latest || !isHumanThread(t)) return [];
    const commit = commits.get(left);
    const tracked = t.pullRequestThreadContext?.trackingCriteria;
    const start = (tracked?.origRightFileStart ?? where.rightFileStart).line;
    const end = (tracked?.origRightFileEnd ?? where.rightFileEnd ?? where.rightFileStart).line;
    const headPath = (where.filePath ?? '').replace(/^\/+/, '');
    const path = (tracked?.origFilePath ?? where.filePath ?? '').replace(/^\/+/, '');
    if (!commit || !path || !start) return [];
    return [{ threadId: String(t.id ?? ''), commit, path, headPath, start, end: end ?? start }];
  });
}

/**
 * Whether `git diff -U0 <from> <to>` changed any of lines `start`–`end` of
 * the `from` side: a hunk that removes or rewrites one of them, or adds lines
 * inside the range. Lines that only moved (an edit above them) aren't changed,
 * as GitHub reads an outdated comment.
 */
export function linesChanged(diff: string, start: number, end: number): boolean {
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
    const at = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count === 0 ? at >= start && at < end : at <= end && at + count - 1 >= start) return true;
  }
  return false;
}

/** The paths (without ADO's leading '/') that threads sit on. */
export function threadPaths(threads: unknown): string[] {
  const paths = list<RawThread>(threads)
    .map((t) => t.threadContext?.filePath?.replace(/^\/+/, ''))
    .filter((p): p is string => !!p);
  return [...new Set(paths)];
}

/** The work items of a `wit/workitems?ids=…&fields=System.Title` answer, as
 *  the PR's issues, each linked to its page. */
export function adoIssuesFrom(items: unknown, ctx: AdoRepoContext): PrIssue[] {
  const org = ctx.organizationUrl.replace(/\/+$/, '');
  return list<{ id?: number; fields?: { 'System.Title'?: string } }>(
    (items as { value?: unknown } | null)?.value,
  ).flatMap((w) =>
    typeof w.id === 'number'
      ? [
          {
            number: w.id,
            title: w.fields?.['System.Title'] ?? '',
            url: `${org}/${encodeURIComponent(ctx.project)}/_workitems/edit/${w.id}`,
          },
        ]
      : [],
  );
}

/**
 * The ForgeReview of an ADO pull request: its threads (fetched with
 * `$iteration=N&$baseIteration=0`, so their positions are tracked onto the
 * latest diff), with ADO's own bookkeeping threads left out. ADO has no
 * "outdated" flag; a thread is outdated, as on GitHub, once its file is gone
 * at head or its lines changed since it was left (`changedSince`).
 */
export function adoReviewFrom(
  raw: {
    pr: unknown;
    iterations: unknown;
    threads: unknown;
    me: string;
    filesAtHead: ReadonlySet<string>;
    /** Threads whose lines have changed since they were left (see
     *  `adoThreadOrigins`, `linesChanged`); none when not given. */
    changedSince?: ReadonlySet<string>;
    checks: PrCheck[];
    /** Its linked work items; none when not given. */
    issues?: PrIssue[];
  },
  ctx: AdoRepoContext,
): ForgeReview {
  const pr = (raw.pr ?? {}) as RawPr;
  const number = pr.pullRequestId ?? 0;
  const { head, base } = latestIteration(raw.iterations);
  const url = prUrl(ctx, number);
  const threads: PrReviewThread[] = [];
  const conversation: PrReviewComment[] = [];

  for (const t of list<RawThread>(raw.threads).filter(isHumanThread)) {
    const tid = String(t.id ?? '');
    const where = t.threadContext;
    const comments = (t.comments ?? [])
      .filter((c) => c.commentType !== 'system' && !c.isDeleted)
      .map((c) => commentFrom(c, tid, threadUrl(url, t), raw.me));
    if (!where) {
      conversation.push(...comments);
      continue;
    }
    const path = (where.filePath ?? '').replace(/^\/+/, '');
    const right = where.rightFileStart ? 'RIGHT' : where.leftFileStart ? 'LEFT' : null;
    const start = right === 'RIGHT' ? where.rightFileStart : where.leftFileStart;
    const end = (right === 'RIGHT' ? where.rightFileEnd : where.leftFileEnd) ?? start;
    const isOutdated = !raw.filesAtHead.has(path) || !!raw.changedSince?.has(tid);
    const line = right && !isOutdated ? (end?.line ?? null) : null;
    threads.push({
      id: tid,
      path,
      line,
      startLine: line !== null && start?.line && start.line !== line ? start.line : null,
      side: right === 'LEFT' ? 'LEFT' : 'RIGHT',
      isOutdated,
      resolved: RESOLVED.has(t.status ?? ''),
      comments,
    });
  }
  conversation.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    provider: 'ado',
    number,
    title: pr.title ?? '',
    body: pr.description ?? '',
    url,
    viewerIsAuthor: !!raw.me && pr.createdBy?.id === raw.me,
    // On the reviewer list and hasn't voted: a vote adds you to the list too,
    // so being on it alone doesn't mean you were asked.
    viewerIsRequestedReviewer:
      !!raw.me && (pr.reviewers ?? []).some((r) => r.id === raw.me && !r.vote),
    viewerIsAssignee: false,
    viewerCommented:
      !!raw.me &&
      list<RawThread>(raw.threads)
        .filter(isHumanThread)
        .some((t) =>
          (t.comments ?? []).some(
            (c) => c.commentType !== 'system' && !c.isDeleted && c.author?.id === raw.me,
          ),
        ),
    verdicts: ADO_VERDICTS,
    base,
    head,
    threads,
    conversation,
    author: pr.createdBy?.displayName || 'Unknown',
    authorUrl: null,
    createdAt: pr.creationDate ?? '',
    lastActivityAt: lastActivity(pr, raw.iterations, raw.threads),
    state: stateFrom(pr),
    baseRef: branchName(pr.targetRefName),
    headRef: branchName(pr.sourceRefName),
    reviewers: reviewersFrom(pr),
    viewerReview: adoViewerReview(pr, raw.iterations, raw.threads, raw.me),
    assignees: [],
    issues: raw.issues ?? [],
    checks: raw.checks,
  };
}

// ── Requests (pure) ─────────────────────────────────────────

// CommentThreadStatus: 1 active, 4 closed. CommentType: 1 text.
const ACTIVE = 1;
const CLOSED = 4;
const TEXT = 1;

/** A new thread on lines `startLine`–`endLine` of the PR's (right) side. */
export function adoThreadBody(
  c: { path: string; startLine: number; endLine: number; body: string },
  at: { iteration: number; changeTrackingId?: number; lastLineLength: number },
): Record<string, unknown> {
  return {
    comments: [{ parentCommentId: 0, content: c.body, commentType: TEXT }],
    status: ACTIVE,
    threadContext: {
      filePath: `/${c.path.replace(/^\/+/, '')}`,
      rightFileStart: { line: c.startLine, offset: 1 },
      // ADO's own whole-line comments end one past the last character.
      rightFileEnd: { line: c.endLine, offset: at.lastLineLength + 1 },
    },
    ...(at.changeTrackingId !== undefined
      ? {
          pullRequestThreadContext: {
            changeTrackingId: at.changeTrackingId,
            iterationContext: {
              firstComparingIteration: at.iteration,
              secondComparingIteration: at.iteration,
            },
          },
        }
      : {}),
  };
}

/** A reply under `parentCommentId`, the thread's first comment (see adoRootCommentId). */
export const adoReplyBody = (body: string, parentCommentId: number) => ({
  content: body,
  parentCommentId,
  commentType: TEXT,
});

/** The review summary: a general thread, closed, since it asks nothing of anyone
 *  (an active one would hold up repos that require every comment resolved). */
export const adoSummaryBody = (body: string) => ({
  comments: [{ parentCommentId: 0, content: body, commentType: TEXT }],
  status: CLOSED,
});

/** The thread and comment of a comment id (`thread:comment`, as
 *  `commentFrom` makes it); throws on anything else. */
export function adoCommentRef(commentId: string): { threadId: string; commentId: string } {
  const [tid, cid, ...rest] = commentId.split(':');
  if (!tid || !cid || rest.length > 0 || !/^\d+$/.test(tid) || !/^\d+$/.test(cid))
    throw new Error(`Not an Azure DevOps comment id: ${commentId}`);
  return { threadId: tid, commentId: cid };
}

/**
 * Like (`on`) or unlike a comment, by its id (see `adoCommentRef`): PUT /
 * DELETE on the comment's likes, under the PR at `prPath`.
 */
export function adoLikeRequest(
  prPath: string,
  commentId: string,
  on: boolean,
): { path: string; method: 'PUT' | 'DELETE' } {
  const ref = adoCommentRef(commentId);
  return {
    path: `${prPath}/threads/${ref.threadId}/comments/${ref.commentId}/likes`,
    method: on ? 'PUT' : 'DELETE',
  };
}

const VOTES: Partial<Record<PrVerdict, number>> = {
  approve: 10,
  approve_with_suggestions: 5,
  wait_for_author: -5,
  reject: -10,
};

/** The reviewer vote for a verdict; null for a plain comment (no vote cast). */
export const adoVote = (verdict: PrVerdict): number | null => VOTES[verdict] ?? null;

/** path (no leading '/') → changeTrackingId, from the pages of an iteration's changes. */
export function changeTrackingIds(pages: unknown[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const page of pages) {
    const entries = (page as { changeEntries?: unknown })?.changeEntries;
    for (const e of Array.isArray(entries) ? entries : []) {
      const path = (e as { item?: { path?: string } }).item?.path;
      const id = (e as { changeTrackingId?: unknown }).changeTrackingId;
      if (path && typeof id === 'number') ids.set(path.replace(/^\/+/, ''), id);
    }
  }
  return ids;
}

/** The PrWriteError for a failed ADO write. */
export function adoWriteError(err: unknown): PrWriteError {
  if (err instanceof AdoRequestError && (err.status === 401 || err.status === 403)) {
    return {
      kind: 'scope',
      fix: 'Give the PAT "Code (Read & write)" in Azure DevOps → User settings → Personal access tokens',
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'other', message: message.split('\n').find((l) => l.trim()) ?? 'unknown error' };
}

// ── The adapter ─────────────────────────────────────────────

export interface AdoDeps {
  request: typeof adoRequest;
  getMyId: (config: NonNullable<PrContext['ado']>) => Promise<string>;
  ensureCommits: typeof ensureCommits;
  filesAtCommit: typeof filesAtCommit;
  /** A file's text at a commit. */
  showFile: (cwd: string, sha: string, path: string) => Promise<string>;
  /** The PR's CI checks; `projectId` is the ADO project's id, which policy evaluations need. */
  checks: (
    ado: NonNullable<PrContext['ado']>,
    number: number,
    projectId: string | undefined,
  ) => Promise<PrCheck[]>;
  /** Fetch branch `branch` from origin into the checkout at `cwd`. */
  fetchBranch: (cwd: string, branch: string) => Promise<void>;
  /** Lines added and deleted from `base`'s merge-base with `head` to `head`,
   *  from local git; null unless both are in the checkout (nothing is fetched). */
  diffStat: typeof localDiffStat;
  /** `git diff -U0 -M <from> <to> -- <paths>` in the checkout at `cwd`: a
   *  file's hunks against its path in `from`, followed through a move. */
  diffHunks: (cwd: string, from: string, to: string, paths: string[]) => Promise<string>;
}

const defaultDeps: AdoDeps = {
  request: adoRequest,
  getMyId: (config) => AzureDevOpsService.getMyId(config),
  ensureCommits,
  filesAtCommit,
  showFile: async (cwd, sha, path) =>
    (
      await execFileAsync('git', ['show', `${sha}:${path}`], {
        cwd,
        timeout: 15_000,
        maxBuffer: 32 * 1024 * 1024,
      })
    ).stdout,
  checks: (ado, number, projectId) =>
    AzureDevOpsService.getPullRequestChecks(ado, ado.repository, number, projectId),
  fetchBranch: async (cwd, branch) => {
    await runGit(cwd, ['fetch', 'origin', branch], 60_000);
  },
  diffStat: localDiffStat,
  diffHunks: (cwd, from, to, paths) =>
    runGit(cwd, ['diff', '-U0', '-M', '--no-color', from, to, '--', ...paths], 15_000),
};

/** How many of a listing's PRs get their row facts, newest first, and how
 *  many PRs are asked about at once: each costs three calls (threads, policy
 *  evaluations, statuses). */
const ROW_FACTS_LIMIT = 10;
const ROW_FACTS_CONCURRENCY = 4;
/** How long a PR's row facts are reused before they're asked again. */
const ROW_FACTS_TTL_MS = 60_000;

function adoOf(ctx: PrContext): NonNullable<PrContext['ado']> {
  if (!ctx.ado) throw new Error('Azure DevOps not configured');
  return ctx.ado;
}

const repoContext = (ado: NonNullable<PrContext['ado']>): AdoRepoContext => ({
  organizationUrl: ado.organizationUrl,
  project: ado.project,
  repository: ado.repository,
});

const repoPath = (ado: NonNullable<PrContext['ado']>) =>
  `${adoProjectSegment(ado)}/_apis/git/repositories/${encodeURIComponent(ado.repository)}`;

export function makeAdoProvider(deps: AdoDeps = defaultDeps): ForgeProvider {
  const prPath = (ctx: PrContext, n: number) => `${repoPath(adoOf(ctx))}/pullRequests/${n}`;

  /**
   * What a failed Azure Pipelines build tells of its failure: its definition
   * and result, its failed tasks and their errors (the timeline), and the log
   * of the task that stopped it, its last lines. A detail ADO won't give
   * becomes a notice; the build's own failure never fails the report.
   */
  const buildFailure = async (
    ado: NonNullable<PrContext['ado']>,
    buildId: number,
  ): Promise<Partial<FailedCheck>> => {
    const at = `${adoProjectSegment(ado)}/_apis/build/builds/${buildId}`;
    const [build, timeline] = await Promise.allSettled([
      deps.request(ado, at),
      deps.request(ado, `${at}/timeline`),
    ]);
    const b =
      build.status === 'fulfilled'
        ? ((build.value ?? {}) as { result?: string; definition?: { name?: string } })
        : {};
    if (timeline.status === 'rejected') {
      return {
        workflow: b.definition?.name ?? '',
        notice: 'The build timeline could not be fetched; open the link.',
      };
    }
    const failure = adoTimelineFailure(timeline.value);
    let log: string | undefined;
    let notice: string | undefined;
    if (failure.logId !== null) {
      try {
        const logs = await deps.request(ado, `${at}/logs`);
        const start = adoLogStartLine(logs, failure.logId);
        const text = await deps.request(ado, `${at}/logs/${failure.logId}?startLine=${start}`, {
          responseType: 'text',
        });
        log = typeof text === 'string' ? adoLogExcerpt(text) : undefined;
      } catch {
        notice = 'The task log could not be fetched (it may have been deleted); open the link.';
      }
    }
    // A build policy reads failing once its build expires (the target moved
    // on), though that build may have passed.
    if (b.result === 'succeeded' && failure.failedSteps.length === 0) {
      notice = 'This build passed but has expired (the target branch moved on); queue it again.';
    }
    return {
      ...(b.result ? { state: b.result } : {}),
      workflow: b.definition?.name ?? '',
      failedSteps: failure.failedSteps,
      annotations: failure.annotations,
      log,
      notice,
    };
  };

  /** The PR's failing checks: each build policy's build with what its
   *  timeline and log tell (see `buildFailure`); a status another service
   *  posted, with its link. */
  const adoFailedChecks = async (ctx: PrContext, number: number): Promise<FailedCheck[]> => {
    const ado = adoOf(ctx);
    const pr = (await deps.request(ado, prPath(ctx, number))) as RawPr | null;
    const checks = await deps.checks(ado, number, pr?.repository?.project?.id);
    return Promise.all(
      checks
        .filter((c) => c.state === 'failing')
        .map(async (c): Promise<FailedCheck> => {
          const check = {
            name: c.name,
            state: 'failed',
            workflow: '',
            link: c.url ?? '',
            description: '',
          };
          const buildId = adoBuildIdOf(c.url);
          if (buildId === null) {
            return { ...check, notice: 'Not an Azure Pipelines build; see the link.' };
          }
          return { ...check, ...(await buildFailure(ado, buildId)) };
        }),
    );
  };

  /**
   * The threads whose lines changed between the commit each was left on and
   * `head`: one diff per commit and path. A commit that can't be fetched (a
   * force-push left it unreachable) or a diff that fails leaves its threads
   * as they were.
   */
  const changedThreads = async (
    cwd: string,
    origins: ThreadOrigin[],
    head: string,
  ): Promise<Set<string>> => {
    const changed = new Set<string>();
    const commits = [...new Set(origins.map((o) => o.commit))];
    const present = new Set(
      (
        await Promise.all(
          commits.map((c) =>
            deps.ensureCommits(cwd, [c]).then(
              () => c,
              () => null,
            ),
          ),
        )
      ).filter((c): c is string => !!c),
    );
    const diffs = new Map<string, Promise<string>>();
    await Promise.all(
      origins
        .filter((o) => present.has(o.commit))
        .map(async (o) => {
          const paths = [...new Set([o.path, o.headPath])];
          const key = `${o.commit}\0${paths.join('\0')}`;
          if (!diffs.has(key))
            diffs.set(
              key,
              deps.diffHunks(cwd, o.commit, head, paths).catch(() => ''),
            );
          if (linesChanged(await diffs.get(key)!, o.start, o.end)) changed.add(o.threadId);
        }),
    );
    return changed;
  };

  const rowFactsCache = new Map<string, { at: number; facts: Promise<Partial<RelevantPr>> }>();

  /**
   * What ADO's PR list leaves out of a row, a few calls per PR: its threads
   * and latest activity (`adoRowFacts`), its checks as one state, and its
   * line counts from local git when its head and target are in the checkout.
   * Whatever can't be read stays null. Reused for a minute per PR and head.
   */
  const rowFacts = (ctx: PrContext, pr: RawPr): Promise<Partial<RelevantPr>> => {
    const ado = adoOf(ctx);
    const id = pr.pullRequestId ?? 0;
    const head = pr.lastMergeSourceCommit?.commitId ?? '';
    const key = `${ado.organizationUrl}|${ado.repository}|${id}|${head}`;
    const hit = rowFactsCache.get(key);
    if (hit && Date.now() - hit.at < ROW_FACTS_TTL_MS) return hit.facts;
    const facts = (async (): Promise<Partial<RelevantPr>> => {
      const [threads, checks, lines] = await Promise.allSettled([
        deps.request(ado, `${repoPath(ado)}/pullRequests/${id}/threads`),
        deps.checks(ado, id, pr.repository?.project?.id),
        deps.diffStat(ctx.cwd, pr.lastMergeTargetCommit?.commitId ?? '', head),
      ]);
      const stat = lines.status === 'fulfilled' ? lines.value : null;
      return {
        ...(threads.status === 'fulfilled' ? adoRowFacts(pr, threads.value) : {}),
        ...(checks.status === 'fulfilled' ? { ci: ciOf(checks.value) } : {}),
        ...(stat ? stat : {}),
      };
    })();
    for (const [k, v] of rowFactsCache) {
      if (Date.now() - v.at >= ROW_FACTS_TTL_MS) rowFactsCache.delete(k);
    }
    rowFactsCache.set(key, { at: Date.now(), facts });
    return facts;
  };

  /** A reply under the thread's first comment, posted at once. */
  const reply: ForgeProvider['reply'] = async (ctx, number, threadId, body) => {
    const ado = adoOf(ctx);
    const at = `${prPath(ctx, number)}/threads/${threadId}`;
    const thread = (await deps.request(ado, at)) as RawThread;
    const posted = (await deps.request(ado, `${at}/comments`, {
      method: 'POST',
      body: adoReplyBody(body, adoRootCommentId(thread)),
    })) as RawComment;
    return commentFrom(posted, threadId, threadUrl(prUrl(repoContext(ado), number), thread));
  };

  /** The PR's linked work items with their titles; none when ADO won't say
   *  (a token without work-item read), which never fails the load. */
  const linkedWorkItems = async (
    ado: NonNullable<PrContext['ado']>,
    at: string,
  ): Promise<PrIssue[]> => {
    try {
      const refs = (await deps.request(ado, `${at}/workitems`)) as {
        value?: { id?: string | number }[];
      } | null;
      const ids = (refs?.value ?? [])
        .map((r) => Number(r.id))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 50);
      if (ids.length === 0) return [];
      const items = await deps.request(
        ado,
        `${adoProjectSegment(ado)}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Title`,
      );
      return adoIssuesFrom(items, repoContext(ado));
    } catch {
      return [];
    }
  };

  return {
    capabilities: FORGE_CAPABILITIES.ado,

    async prsFrom(ctx, branch) {
      const ado = adoOf(ctx);
      const res = await deps.request(
        ado,
        `${repoPath(ado)}/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(
          `refs/heads/${branch}`,
        )}&searchCriteria.status=all&$top=10`,
      );
      return Promise.all(
        list<RawPr>(res).map(async (pr) => {
          const open = pr.status !== 'completed' && pr.status !== 'abandoned';
          const ci = open
            ? ciOf(
                await deps
                  .checks(ado, pr.pullRequestId ?? 0, pr.repository?.project?.id)
                  .catch(() => []),
              )
            : null;
          return adoBranchPrFrom(pr, repoContext(ado), ci);
        }),
      );
    },

    async listOpen(ctx) {
      const ado = adoOf(ctx);
      const res = await deps.request(ado, `${repoPath(ado)}/pullrequests?${adoPrListQuery()}`);
      return mapAdoPrList(list(res), repoContext(ado));
    },

    // A fork PR's source branch isn't on origin; the fetch fails and says so.
    async prepareBranch(ctx, pr) {
      await deps.fetchBranch(ctx.cwd, pr.headRefName);
      return pr.headRefName;
    },

    failedChecks: async (ctx, number) => adoFailedChecks(ctx, number),

    // ADO doesn't match a commit's author to a profile page.
    commitAuthorUrl: async () => null,

    /** The listing, with the row facts ADO's list leaves out (see
     *  `rowFacts`) filled in for its newest PRs. */
    async list(ctx, filter) {
      const ado = adoOf(ctx);
      const res = (await deps.request(
        ado,
        `${repoPath(ado)}/pullrequests?${adoPrListQuery(filter)}`,
      )) as {
        value?: unknown;
      } | null;
      const raw = list<RawPr>(res);
      const rows = mapAdoRelevantPrs(raw, repoContext(ado));
      const newest = rows
        .map((row, i) => ({ row, raw: raw[i]! }))
        .sort((a, b) => b.row.number - a.row.number)
        .slice(0, ROW_FACTS_LIMIT);
      const facts = new Map<number, Partial<RelevantPr>>();
      for (let i = 0; i < newest.length; i += ROW_FACTS_CONCURRENCY) {
        const batch = newest.slice(i, i + ROW_FACTS_CONCURRENCY);
        const got = await Promise.all(batch.map((n) => rowFacts(ctx, n.raw)));
        batch.forEach((n, j) => facts.set(n.row.number, got[j]!));
      }
      return rows.map((row) => ({ ...row, ...facts.get(row.number) }));
    },

    async load(ctx, number) {
      const ado = adoOf(ctx);
      const at = prPath(ctx, number);
      const [pr, iterations, me] = await Promise.all([
        deps.request(ado, at),
        deps.request(ado, `${at}/iterations`),
        deps.getMyId(ado).catch(() => ''),
      ]);
      const { id, head, base } = latestIteration(iterations);
      const [threads, checks, issues] = await Promise.all([
        deps.request(ado, `${at}/threads?$iteration=${id}&$baseIteration=0`),
        deps.checks(ado, number, (pr as RawPr | null)?.repository?.project?.id),
        linkedWorkItems(ado, at),
      ]);
      const baseTip = (pr as RawPr | null)?.lastMergeTargetCommit?.commitId || null;
      // The PR's merge ref holds its head (a fork's too) and the target, should
      // Azure Repos refuse a fetch by sha.
      await deps.ensureCommits(ctx.cwd, [base, head, ...(baseTip ? [baseTip] : [])], undefined, [
        `refs/pull/${number}/merge`,
      ]);
      const [filesAtHead, changedSince] = await Promise.all([
        deps.filesAtCommit(ctx.cwd, head, threadPaths(threads)),
        changedThreads(ctx.cwd, adoThreadOrigins(threads, iterations, id), head),
      ]);
      return {
        ...adoReviewFrom(
          { pr, iterations, threads, me, filesAtHead, changedSince, checks, issues },
          repoContext(ado),
        ),
        baseTip,
      };
    },

    reply,

    // A general comment is a thread without a file: the reply goes in it.
    replyGeneral: async (ctx, number, to, body) =>
      reply(ctx, number, adoCommentRef(to.id).threadId, body),

    async react(ctx, number, commentId, content: PrReactionContent, on) {
      if (content !== 'LIKE') throw new Error('Azure DevOps has only likes');
      const req = adoLikeRequest(prPath(ctx, number), commentId, on);
      await deps.request(adoOf(ctx), req.path, { method: req.method });
    },

    async setResolved(ctx, number, threadId, resolved) {
      await deps.request(adoOf(ctx), `${prPath(ctx, number)}/threads/${threadId}`, {
        method: 'PATCH',
        body: { status: resolved ? 'fixed' : 'active' },
      });
    },

    /**
     * ADO has no pending review: each comment posts on its own, then the
     * replies, the vote and the summary. The first failure stops the run, and the drafts
     * that did post are reported so they aren't posted twice.
     */
    async submit(ctx, number, s) {
      if (
        s.comments.length === 0 &&
        s.replies.length === 0 &&
        !s.body.trim() &&
        adoVote(s.verdict) === null
      ) {
        return { postedDraftIds: [], error: { kind: 'other', message: 'Nothing to submit' } };
      }
      const ado = adoOf(ctx);
      const at = prPath(ctx, number);
      const posted: string[] = [];
      try {
        let tracking = new Map<string, number>();
        let iteration = 0;
        let head = '';
        if (s.comments.length > 0) {
          ({ id: iteration, head } = latestIteration(await deps.request(ado, `${at}/iterations`)));
          const pages: unknown[] = [];
          for (let skip = 0; ; ) {
            const page = (await deps.request(
              ado,
              `${at}/iterations/${iteration}/changes?$top=2000&$skip=${skip}`,
            )) as { nextSkip?: number };
            pages.push(page);
            if (!page?.nextSkip) break;
            skip = page.nextSkip;
          }
          tracking = changeTrackingIds(pages);
        }
        const lines = new Map<string, string[]>();
        for (const c of s.comments) {
          if (!lines.has(c.path)) {
            const text = await deps.showFile(ctx.cwd, head, c.path).catch(() => '');
            lines.set(c.path, text.split('\n'));
          }
          const lastLineLength = lines.get(c.path)![c.endLine - 1]?.length ?? 0;
          await deps.request(ado, `${at}/threads`, {
            method: 'POST',
            body: adoThreadBody(c, {
              iteration,
              changeTrackingId: tracking.get(c.path),
              lastLineLength,
            }),
          });
          posted.push(c.draftId);
        }
        for (const r of s.replies) {
          const thread = await deps.request(ado, `${at}/threads/${r.threadId}`);
          await deps.request(ado, `${at}/threads/${r.threadId}/comments`, {
            method: 'POST',
            body: adoReplyBody(r.body, adoRootCommentId(thread)),
          });
          posted.push(r.draftId);
        }
        // The vote before the summary: a vote is safe to repeat and a summary
        // isn't, so whatever a retry repeats after a failure is harmless.
        const vote = adoVote(s.verdict);
        if (vote !== null) {
          const me = await deps.getMyId(ado);
          await deps.request(ado, `${at}/reviewers/${me}`, { method: 'PUT', body: { vote } });
        }
        if (s.body.trim()) {
          await deps.request(ado, `${at}/threads`, {
            method: 'POST',
            body: adoSummaryBody(s.body),
          });
        }
        return { postedDraftIds: posted };
      } catch (err) {
        const error = adoWriteError(err);
        if (posted.length > 0 && error.kind === 'other') {
          error.message = `Comments posted; ${error.message}`;
        }
        return { postedDraftIds: posted, error };
      }
    },
  };
}

export const adoProvider: ForgeProvider = makeAdoProvider();
