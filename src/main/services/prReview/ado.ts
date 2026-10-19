import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  PrReview,
  PrReviewComment,
  PrReviewThread,
  PrVerdict,
  PrWriteError,
} from '@shared/types';
import {
  AdoRequestError,
  AzureDevOpsService,
  adoProjectSegment,
  adoRequest,
} from '../AzureDevOpsService';
import { ensureCommits, filesAtCommit } from './localCommits';
import type { PrContext, PrReviewProvider } from './types';

const execFileAsync = promisify(execFile);

// ── Mapping (pure) ──────────────────────────────────────────

interface RawPosition {
  line?: number;
  offset?: number;
}
interface RawComment {
  id?: number;
  content?: string;
  commentType?: string;
  isDeleted?: boolean;
  publishedDate?: string;
  author?: { displayName?: string } | null;
}
interface RawThread {
  id?: number;
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
  comments?: RawComment[];
}
interface RawIteration {
  id?: number;
  sourceRefCommit?: { commitId?: string };
  commonRefCommit?: { commitId?: string };
}
interface RawPr {
  pullRequestId?: number;
  title?: string;
  createdBy?: { id?: string } | null;
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

/** A person's thread, not one ADO writes about pushes, votes, reviewers or policies. */
const isHumanThread = (t: RawThread) =>
  !t.isDeleted &&
  !t.properties?.CodeReviewThreadType &&
  (t.comments ?? []).some((c) => c.commentType !== 'system' && !c.isDeleted);

/** The paths (without ADO's leading '/') that threads sit on. */
export function threadPaths(threads: unknown): string[] {
  const paths = list<RawThread>(threads)
    .map((t) => t.threadContext?.filePath?.replace(/^\/+/, ''))
    .filter((p): p is string => !!p);
  return [...new Set(paths)];
}

/**
 * The PrReview of an ADO pull request: its threads (fetched with
 * `$iteration=N&$baseIteration=0`, so their positions are tracked onto the
 * latest diff), with ADO's own bookkeeping threads left out. ADO has no
 * "outdated" flag; a thread whose file is gone at head counts as outdated.
 */
export function adoReviewFrom(
  raw: {
    pr: unknown;
    iterations: unknown;
    threads: unknown;
    me: string;
    filesAtHead: ReadonlySet<string>;
  },
  ctx: AdoRepoContext,
): PrReview {
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
      .map(
        (c): PrReviewComment => ({
          id: `${tid}:${c.id ?? ''}`,
          author: c.author?.displayName || 'Unknown',
          body: c.content ?? '',
          createdAt: c.publishedDate ?? '',
          url: `${url}?_a=${where ? 'files' : 'overview'}&discussionId=${tid}`,
        }),
      );
    if (!where) {
      conversation.push(...comments);
      continue;
    }
    const path = (where.filePath ?? '').replace(/^\/+/, '');
    const right = where.rightFileStart ? 'RIGHT' : where.leftFileStart ? 'LEFT' : null;
    const start = right === 'RIGHT' ? where.rightFileStart : where.leftFileStart;
    const end = (right === 'RIGHT' ? where.rightFileEnd : where.leftFileEnd) ?? start;
    const isOutdated = !raw.filesAtHead.has(path);
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
    url,
    viewerIsAuthor: !!raw.me && pr.createdBy?.id === raw.me,
    verdicts: ADO_VERDICTS,
    base,
    head,
    threads,
    conversation,
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

export const adoReplyBody = (body: string) => ({
  content: body,
  parentCommentId: 1,
  commentType: TEXT,
});

/** The review summary: a general thread, closed, since it asks nothing of anyone
 *  (an active one would hold up repos that require every comment resolved). */
export const adoSummaryBody = (body: string) => ({
  comments: [{ parentCommentId: 0, content: body, commentType: TEXT }],
  status: CLOSED,
});

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
};

function adoOf(ctx: PrContext): NonNullable<PrContext['ado']> {
  if (!ctx.ado) throw new Error('Azure DevOps not configured');
  return ctx.ado;
}

const repoPath = (ado: NonNullable<PrContext['ado']>) =>
  `${adoProjectSegment(ado)}/_apis/git/repositories/${encodeURIComponent(ado.repository)}`;

export function makeAdoProvider(deps: AdoDeps = defaultDeps): PrReviewProvider {
  const prPath = (ctx: PrContext, n: number) => `${repoPath(adoOf(ctx))}/pullRequests/${n}`;

  return {
    list: (ctx) => AzureDevOpsService.listPullRequests(adoOf(ctx), adoOf(ctx).repository),

    async load(ctx, number) {
      const ado = adoOf(ctx);
      const at = prPath(ctx, number);
      const [pr, iterations, me] = await Promise.all([
        deps.request(ado, at),
        deps.request(ado, `${at}/iterations`),
        deps.getMyId(ado).catch(() => ''),
      ]);
      const { id, head, base } = latestIteration(iterations);
      const threads = await deps.request(ado, `${at}/threads?$iteration=${id}&$baseIteration=0`);
      await deps.ensureCommits(ctx.cwd, [base, head]);
      const filesAtHead = await deps.filesAtCommit(ctx.cwd, head, threadPaths(threads));
      return adoReviewFrom(
        { pr, iterations, threads, me, filesAtHead },
        { organizationUrl: ado.organizationUrl, project: ado.project, repository: ado.repository },
      );
    },

    async setResolved(ctx, number, threadId, resolved) {
      await deps.request(adoOf(ctx), `${prPath(ctx, number)}/threads/${threadId}`, {
        method: 'PATCH',
        body: { status: resolved ? 'fixed' : 'active' },
      });
    },

    /**
     * ADO has no pending review: each comment posts on its own, then the
     * summary and the vote. The first failure stops the run, and the drafts
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
          await deps.request(ado, `${at}/threads/${r.threadId}/comments`, {
            method: 'POST',
            body: adoReplyBody(r.body),
          });
          posted.push(r.draftId);
        }
        if (s.body.trim()) {
          await deps.request(ado, `${at}/threads`, {
            method: 'POST',
            body: adoSummaryBody(s.body),
          });
        }
        const vote = adoVote(s.verdict);
        if (vote !== null) {
          const me = await deps.getMyId(ado);
          await deps.request(ado, `${at}/reviewers/${me}`, { method: 'PUT', body: { vote } });
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

export const adoProvider: PrReviewProvider = makeAdoProvider();
