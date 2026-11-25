import { describe, it, expect } from 'vitest';
import type { PrSubmission } from '../../../../shared/types';
import prFixture from './fixtures/github-pr.json';
import relevantFixture from './fixtures/github-relevant-prs.json';
import {
  githubRelevantPrsFrom,
  githubReplyRequest,
  githubReviewFrom,
  githubWriteError,
  makeGithubProvider,
  restCommentFrom,
  type Gql,
  type Rest,
} from '../github';

const comment = (
  id: string,
  login: string | null,
  body = 'b',
  createdAt = '2026-10-17T10:00:00Z',
) => ({
  id,
  author: login === null ? null : { login },
  body,
  createdAt,
  url: `u/${id}`,
});
const at = { number: 4, base: 'B', head: 'H', viewer: 'me' };

describe('githubReviewFrom', () => {
  it('keeps every review thread, resolved or not, with its comments', () => {
    const pr = {
      reviewThreads: {
        nodes: [
          {
            id: 'T1',
            isResolved: false,
            isOutdated: false,
            path: 'src/a.ts',
            line: 12,
            startLine: 10,
            diffSide: 'RIGHT',
            comments: { nodes: [comment('C1', 'rev', 'Null here'), comment('C2', 'me', 'ok')] },
          },
          {
            id: 'T2',
            isResolved: true,
            isOutdated: false,
            path: 'src/b.ts',
            line: 3,
            diffSide: 'RIGHT',
            comments: { nodes: [comment('C3', 'rev')] },
          },
          {
            id: 'T3',
            isResolved: false,
            isOutdated: true,
            path: 'src/c.ts',
            line: null,
            startLine: null,
            diffSide: 'LEFT',
            comments: { nodes: [comment('C4', null)] },
          },
        ],
      },
    };
    const { threads } = githubReviewFrom(pr, at);
    expect(
      threads.map((t) => [t.id, t.resolved, t.side, t.line, t.startLine, t.isOutdated]),
    ).toEqual([
      ['T1', false, 'RIGHT', 12, 10, false],
      ['T2', true, 'RIGHT', 3, null, false],
      ['T3', false, 'LEFT', null, null, true],
    ]);
    expect(threads[0]!.comments[0]).toEqual({
      id: 'C1',
      author: 'rev',
      body: 'Null here',
      createdAt: '2026-10-17T10:00:00Z',
      url: 'u/C1',
    });
    // A deleted account reads as GitHub's "ghost".
    expect(threads[2]!.comments[0]!.author).toBe('ghost');
  });

  it('merges general comments and review summaries into the conversation, oldest first', () => {
    const pr = {
      comments: {
        nodes: [
          comment('IC2', 'ann', 'later', '2026-10-17T12:00:00Z'),
          comment('IC1', 'bo', 'first', '2026-10-17T09:00:00Z'),
        ],
      },
      reviews: {
        nodes: [
          {
            ...comment('R1', 'cy', 'Looks good overall', '2026-10-17T11:00:00Z'),
            state: 'APPROVED',
          },
          { ...comment('R2', 'cy', '', '2026-10-17T11:30:00Z'), state: 'COMMENTED' },
          { ...comment('R3', 'me', 'draft summary', '2026-10-17T11:45:00Z'), state: 'PENDING' },
        ],
      },
    };
    expect(githubReviewFrom(pr, at).conversation.map((c) => c.id)).toEqual(['IC1', 'R1', 'IC2']);
  });

  it('describes the PR and offers only "comment" on your own PR', () => {
    const base = { title: 'Fix it', body: 'Because', url: 'https://x/pull/4' };
    const theirs = githubReviewFrom({ ...base, viewerDidAuthor: false }, at);
    expect(theirs).toMatchObject({
      provider: 'github',
      number: 4,
      title: 'Fix it',
      body: 'Because',
      url: 'https://x/pull/4',
      base: 'B',
      head: 'H',
      viewerIsAuthor: false,
      verdicts: ['comment', 'approve', 'request_changes'],
    });
    expect(theirs.partial).toBeUndefined();
    expect(githubReviewFrom({ ...base, viewerDidAuthor: true }, at).verdicts).toEqual(['comment']);
  });

  it('describes who wrote it, where it stands, its branches, people and checks', () => {
    const review = githubReviewFrom(prFixture, at);
    expect(review).toMatchObject({
      author: 'bo',
      authorUrl: 'https://github.com/bo',
      createdAt: '2026-11-01T09:00:00Z',
      lastActivityAt: '2026-11-20T15:30:00Z',
      state: 'open',
      baseRef: 'main',
      headRef: 'fix/it',
      assignees: ['bo', 'ann'],
    });
    // A re-request outranks the review before it; a dismissed review doesn't
    // count; a comment after an approval leaves it approved.
    expect(review.reviewers).toEqual([
      { name: 'ann', url: 'https://github.com/ann', state: 'approved' },
      { name: 'cy', url: 'https://github.com/cy', state: 'pending' },
      { name: 'di', url: null, state: 'commented' },
      { name: 'fay', url: null, state: 'approved' },
      { name: 'core-team', url: 'https://github.com/orgs/o/teams/core-team', state: 'pending' },
    ]);
    expect(review.checks).toEqual([
      { name: 'test', state: 'passing', url: 'https://github.com/o/r/actions/runs/1' },
      { name: 'lint', state: 'failing', url: 'https://github.com/o/r/actions/runs/2' },
      { name: 'deploy', state: 'skipped', url: null },
      { name: 'ci/circleci', state: 'pending', url: 'https://circleci.com/x' },
    ]);
    const state = (over: object) => githubReviewFrom({ ...prFixture, ...over }, at).state;
    expect(state({ isDraft: true })).toBe('draft');
    expect(state({ state: 'MERGED' })).toBe('merged');
    expect(state({ state: 'CLOSED', isDraft: true })).toBe('closed');
  });

  it("says whether you're a requested reviewer, by your login", () => {
    const pr = {
      reviewRequests: {
        nodes: [{ requestedReviewer: { login: 'other' } }, { requestedReviewer: {} }],
      },
    };
    expect(githubReviewFrom(pr, at).viewerIsRequestedReviewer).toBe(false);
    pr.reviewRequests.nodes.push({ requestedReviewer: { login: 'me' } });
    expect(githubReviewFrom(pr, at).viewerIsRequestedReviewer).toBe(true);
    expect(githubReviewFrom(pr, { ...at, viewer: '' }).viewerIsRequestedReviewer).toBe(false);
  });

  it('flags a review with more threads than were loaded', () => {
    const pr = { reviewThreads: { pageInfo: { hasNextPage: true }, nodes: [] } };
    expect(githubReviewFrom(pr, at).partial).toBe(true);
  });

  it('tolerates junk', () => {
    expect(githubReviewFrom(null, at)).toMatchObject({
      threads: [],
      conversation: [],
      title: '',
      author: 'ghost',
      state: 'open',
      reviewers: [],
      assignees: [],
      checks: [],
    });
    expect(
      githubReviewFrom({ reviewThreads: { nodes: [null, { isResolved: false }] } }, at).threads,
    ).toEqual([
      {
        id: '',
        path: '',
        line: null,
        startLine: null,
        side: 'RIGHT',
        isOutdated: false,
        resolved: false,
        comments: [],
      },
    ]);
  });
});

type Call = { query: string; vars: Record<string, string | number | boolean> };

/** A fake `gh api graphql` that records calls and answers by mutation name. */
function fakeGql(answers: { pending?: boolean; failOn?: string; noRoot?: boolean } = {}) {
  const calls: Call[] = [];
  const gql: Gql = async (_cwd, query, vars) => {
    calls.push({ query, vars });
    const op =
      /(addPullRequestReviewThreadReply|addPullRequestReviewThread|addPullRequestReview|submitPullRequestReview|deletePullRequestReview|unresolveReviewThread|resolveReviewThread|pullRequest\(number|node\(id)/.exec(
        query,
      )?.[1];
    if (answers.failOn && op === answers.failOn) throw new Error('GraphQL: something broke');
    if (op === 'pullRequest(number')
      return {
        repository: {
          pullRequest: { id: 'PR_1', reviews: { nodes: answers.pending ? [{ id: 'R_old' }] : [] } },
        },
      };
    if (op === 'node(id')
      return { node: { comments: { nodes: answers.noRoot ? [] : [{ databaseId: 1234 }] } } };
    if (op === 'addPullRequestReview')
      return { addPullRequestReview: { pullRequestReview: { id: 'R_1' } } };
    return {};
  };
  const ops = () => calls.map((c) => /(?:mutation|query)[^{]*\{\s*(\w+)/.exec(c.query)?.[1] ?? '?');
  return { gql, calls, ops };
}

const ctx = { cwd: '/repo', projectId: 'p1', remote: null };
const submission: PrSubmission = {
  verdict: 'request_changes',
  body: 'Two things',
  comments: [
    { draftId: 'd1', path: 'src/a.ts', startLine: 3, endLine: 3, body: 'one line' },
    { draftId: 'd2', path: 'src/b.ts', startLine: 10, endLine: 12, body: 'a range' },
  ],
  replies: [{ draftId: 'd3', threadId: 'T_9', body: 'agreed' }],
};

describe('githubProvider.submit', () => {
  it('puts comments and replies in one pending review, then submits it with the verdict', async () => {
    const { gql, calls, ops } = fakeGql();
    const result = await makeGithubProvider(gql).submit(ctx, 4, submission);
    expect(result).toEqual({ postedDraftIds: ['d1', 'd2', 'd3'] });
    expect(ops()).toEqual([
      'repository',
      'addPullRequestReview',
      'addPullRequestReviewThread',
      'addPullRequestReviewThread',
      'addPullRequestReviewThreadReply',
      'submitPullRequestReview',
    ]);
    expect(calls[0]!.vars).toEqual({ owner: '{owner}', name: '{repo}', number: 4 });
    expect(calls[2]!.vars).toEqual({ review: 'R_1', path: 'src/a.ts', line: 3, body: 'one line' });
    expect(calls[2]!.query).not.toContain('startLine');
    expect(calls[3]!.vars).toEqual({
      review: 'R_1',
      path: 'src/b.ts',
      line: 12,
      body: 'a range',
      startLine: 10,
    });
    expect(calls[3]!.query).toContain('startSide: RIGHT');
    expect(calls[4]!.vars).toEqual({ review: 'R_1', thread: 'T_9', body: 'agreed' });
    expect(calls[5]!.vars).toEqual({ review: 'R_1', event: 'REQUEST_CHANGES', body: 'Two things' });
  });

  it('deletes the pending review and posts nothing when a step fails', async () => {
    const { gql, ops } = fakeGql({ failOn: 'addPullRequestReviewThreadReply' });
    const result = await makeGithubProvider(gql).submit(ctx, 4, submission);
    expect(result).toEqual({
      postedDraftIds: [],
      error: { kind: 'other', message: 'GraphQL: something broke' },
    });
    expect(ops().at(-1)).toBe('deletePullRequestReview');
  });

  it('refuses to write when the viewer already has a pending review on GitHub', async () => {
    const { gql, ops } = fakeGql({ pending: true });
    expect(await makeGithubProvider(gql).submit(ctx, 4, submission)).toEqual({
      postedDraftIds: [],
      error: { kind: 'pending-review' },
    });
    expect(ops()).toEqual(['repository']);
  });

  it('refuses an empty comment-only submission without calling GitHub', async () => {
    const { gql, calls } = fakeGql();
    const empty: PrSubmission = { verdict: 'comment', body: ' ', comments: [], replies: [] };
    expect((await makeGithubProvider(gql).submit(ctx, 4, empty)).error).toEqual({
      kind: 'other',
      message: 'Nothing to submit',
    });
    expect(calls).toEqual([]);
  });

  it('approves with no comments', async () => {
    const { gql, calls } = fakeGql();
    const approve: PrSubmission = { verdict: 'approve', body: '', comments: [], replies: [] };
    expect(await makeGithubProvider(gql).submit(ctx, 4, approve)).toEqual({ postedDraftIds: [] });
    expect(calls.at(-1)!.vars).toMatchObject({ event: 'APPROVE' });
  });
});

describe('githubRelevantPrsFrom', () => {
  it('maps each listed PR with its counts, threads and rolled-up checks', () => {
    const [own, draft] = githubRelevantPrsFrom(relevantFixture);
    expect(own).toEqual({
      number: 215,
      title: 'Review mode tabs',
      url: 'https://github.com/o/r/pull/215',
      state: 'open',
      draft: false,
      author: 'alice',
      headRefName: 'feat/tabs',
      baseRefName: 'main',
      provider: 'github',
      fromFork: false,
      updatedAt: '2026-11-24T09:00:00Z',
      additions: 120,
      deletions: 14,
      threads: { open: 2, total: 3 },
      ci: 'failing',
    });
    expect(draft).toMatchObject({
      state: 'open',
      draft: true,
      author: '',
      fromFork: true,
      threads: { open: 0, total: 0 },
      ci: null,
    });
  });

  it('is empty for an answer without the repository', () => {
    expect(githubRelevantPrsFrom({})).toEqual([]);
  });
});

describe('githubProvider.list', () => {
  it('asks for one side of the branch, leaving the other unset', async () => {
    const calls: Record<string, unknown>[] = [];
    const gql: Gql = async (_cwd, _query, vars) => {
      calls.push(vars);
      return relevantFixture;
    };
    const prs = await makeGithubProvider(gql).list(ctx, { base: 'feat/tabs' });
    expect(prs.map((p) => p.number)).toEqual([215, 210]);
    expect(calls).toEqual([{ owner: '{owner}', name: '{repo}', base: 'feat/tabs' }]);
  });
});

describe('githubProvider.setResolved', () => {
  it('resolves or unresolves the thread', async () => {
    const { gql, ops, calls } = fakeGql();
    const gh = makeGithubProvider(gql);
    await gh.setResolved(ctx, 4, 'T_1', true);
    await gh.setResolved(ctx, 4, 'T_1', false);
    expect(ops()).toEqual(['resolveReviewThread', 'unresolveReviewThread']);
    expect(calls[0]!.vars).toEqual({ id: 'T_1' });
  });
});

describe('githubProvider.reply', () => {
  it("posts at once through REST, under the thread's first comment", () => {
    expect(githubReplyRequest(4, 1234, 'agreed')).toEqual({
      method: 'POST',
      path: 'repos/{owner}/{repo}/pulls/4/comments/1234/replies',
      fields: { body: 'agreed' },
    });
  });

  it('looks up the first comment, posts, and answers the comment', async () => {
    const { gql, calls } = fakeGql();
    const posts: Parameters<Rest>[] = [];
    const rest: Rest = async (...args) => {
      posts.push(args);
      return {
        id: 99,
        node_id: 'PRRC_9',
        user: { login: 'me' },
        body: 'agreed',
        created_at: '2026-11-24T10:00:00Z',
        html_url: 'https://github.com/o/r/pull/4#discussion_r99',
      };
    };
    const comment = await makeGithubProvider(gql, rest).reply(ctx, 4, 'PRRT_1', 'agreed');
    expect(calls[0]!.vars).toEqual({ thread: 'PRRT_1' });
    expect(posts).toEqual([
      ['/repo', 'POST', 'repos/{owner}/{repo}/pulls/4/comments/1234/replies', { body: 'agreed' }],
    ]);
    expect(comment).toEqual({
      id: 'PRRC_9',
      author: 'me',
      body: 'agreed',
      createdAt: '2026-11-24T10:00:00Z',
      url: 'https://github.com/o/r/pull/4#discussion_r99',
    });
  });

  it('refuses a thread without a comment, posting nothing', async () => {
    const { gql } = fakeGql({ noRoot: true });
    const rest: Rest = async () => {
      throw new Error('should not post');
    };
    await expect(makeGithubProvider(gql, rest).reply(ctx, 4, 'PRRT_1', 'x')).rejects.toThrow(
      'no comment',
    );
  });

  it('reads a deleted account as ghost', () => {
    expect(restCommentFrom({ node_id: 'X', user: null }).author).toBe('ghost');
  });
});

describe('githubWriteError', () => {
  it('tells a missing scope apart, with the fix', () => {
    for (const msg of [
      'GraphQL: Your token has not been granted the required scopes to execute this query.',
      'GraphQL: Resource not accessible by personal access token (addPullRequestReview)',
      'INSUFFICIENT_SCOPES',
    ]) {
      expect(githubWriteError(new Error(msg))).toEqual({
        kind: 'scope',
        fix: 'gh auth refresh -s repo',
      });
    }
  });

  it('keeps the first line of anything else', () => {
    expect(githubWriteError(new Error('\nGraphQL: Not Found\nmore'))).toEqual({
      kind: 'other',
      message: 'GraphQL: Not Found',
    });
  });
});
