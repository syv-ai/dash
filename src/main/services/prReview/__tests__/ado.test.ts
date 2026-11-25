import { describe, it, expect } from 'vitest';
import threadsFixture from './fixtures/ado-threads.json';
import prFixture from './fixtures/ado-pr.json';
import type { PrSubmission } from '../../../../shared/types';
import { AdoRequestError } from '../../AzureDevOpsService';
import {
  adoReplyBody,
  adoRootCommentId,
  adoReviewFrom,
  adoSummaryBody,
  adoThreadBody,
  adoVote,
  adoWriteError,
  changeTrackingIds,
  newestDate,
  makeAdoProvider,
  threadPaths,
  type AdoDeps,
} from '../ado';

const ctx = { organizationUrl: 'https://dev.azure.com/org', project: 'Proj', repository: 'repo' };
const iterations = {
  value: [
    { id: 1, sourceRefCommit: { commitId: 'old' }, commonRefCommit: { commitId: 'base0' } },
    { id: 11, sourceRefCommit: { commitId: 'HEAD11' }, commonRefCommit: { commitId: 'BASE11' } },
    { id: 9, sourceRefCommit: { commitId: 'h9' }, commonRefCommit: { commitId: 'b9' } },
  ],
};
const pr = prFixture;
const checks = [{ name: 'CI', state: 'passing' as const, url: 'https://ci/1' }];
const filesAtHead = new Set(['src/app/moved.ts', 'src/app/unmoved.ts']);

describe('adoReviewFrom', () => {
  const review = adoReviewFrom(
    { pr, iterations, threads: threadsFixture, me: 'me-id', filesAtHead, checks },
    ctx,
  );

  it('describes the PR from its latest iteration', () => {
    expect(review).toMatchObject({
      provider: 'ado',
      number: 7204,
      title: 'Wire inputs',
      body: 'Why',
      url: 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/7204',
      viewerIsAuthor: false,
      base: 'BASE11',
      head: 'HEAD11',
      verdicts: ['comment', 'approve', 'approve_with_suggestions', 'wait_for_author', 'reject'],
    });
    expect(
      adoReviewFrom({ pr, iterations, threads: [], me: 'author-id', filesAtHead, checks }, ctx)
        .viewerIsAuthor,
    ).toBe(true);
  });

  it('describes who wrote it, where it stands, its branches, reviewers and checks', () => {
    expect(review).toMatchObject({
      author: 'Bo Author',
      state: 'open',
      baseRef: 'main',
      headRef: 'feature/wire-inputs',
      assignees: [],
      checks,
    });
    expect(review.reviewers).toEqual([
      { name: 'Ann Reviewer', url: null, state: 'approved_with_suggestions' },
      { name: 'Cy Lead', url: null, state: 'waiting' },
      { name: '[Proj]\\Proj Team', url: null, state: 'pending' },
      { name: 'Di Ops', url: null, state: 'approved' },
      { name: 'Ed Sec', url: null, state: 'rejected' },
    ]);
    const at = (over: object) =>
      adoReviewFrom(
        { pr: { ...pr, ...over }, iterations, threads: [], me: '', filesAtHead, checks: [] },
        ctx,
      ).state;
    expect(at({ isDraft: true })).toBe('draft');
    expect(at({ status: 'completed' })).toBe('merged');
    expect(at({ status: 'abandoned' })).toBe('closed');
  });

  it('dates it: created, and the newest of its pushes, threads and comments', () => {
    const dated = adoReviewFrom(
      {
        pr: { ...pr, creationDate: '2026-11-01T09:00:00Z' },
        iterations: {
          value: [{ ...iterations.value[1], createdDate: '2026-11-03T00:00:00Z' }],
        },
        threads: [
          { id: 1, lastUpdatedDate: '2026-11-04T00:00:00Z', comments: [] },
          {
            id: 2,
            comments: [{ id: 1, publishedDate: '2026-11-02T00:00:00Z' }],
            lastUpdatedDate: 'not a date',
          },
        ],
        me: '',
        filesAtHead,
        checks: [],
      },
      ctx,
    );
    expect(dated).toMatchObject({
      createdAt: '2026-11-01T09:00:00Z',
      lastActivityAt: '2026-11-04T00:00:00Z',
      authorUrl: null,
    });
    expect(review.createdAt).toBe('');
  });

  it("says whether you're on the reviewer list and haven't voted", () => {
    const asked = (reviewers: { id: string; vote: number }[]) =>
      adoReviewFrom(
        { pr: { ...pr, reviewers }, iterations, threads: [], me: 'me-id', filesAtHead, checks },
        ctx,
      ).viewerIsRequestedReviewer;
    expect(review.viewerIsRequestedReviewer).toBe(false);
    expect(asked([{ id: 'me-id', vote: 0 }])).toBe(true);
    expect(asked([{ id: 'me-id', vote: 10 }])).toBe(false);
    expect(asked([{ id: 'other', vote: 0 }])).toBe(false);
  });

  it('maps file threads, with tracked positions, sides, resolution and outdated files', () => {
    expect(
      review.threads.map((t) => [
        t.id,
        t.path,
        t.side,
        t.startLine,
        t.line,
        t.resolved,
        t.isOutdated,
      ]),
    ).toEqual([
      ['101', 'src/app/moved.ts', 'RIGHT', 108, 120, false, false],
      ['102', 'src/app/unmoved.ts', 'RIGHT', null, 40, true, false],
      ['103', 'src/app/deleted.ts', 'RIGHT', null, null, true, true],
      ['104', 'src/app/moved.ts', 'LEFT', null, 12, false, false],
    ]);
  });

  it('keeps people’s comments, not deleted ones, with ids unique across threads', () => {
    expect(review.threads[0]!.comments).toEqual([
      {
        id: '101:1',
        author: 'Ann Reviewer',
        body: 'This can throw.',
        createdAt: '2026-10-10T09:00:00Z',
        url: 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/7204?_a=files&discussionId=101',
      },
      expect.objectContaining({ id: '101:2', author: 'Bo Author' }),
    ]);
  });

  it('puts general threads in the conversation, oldest first, and drops ADO’s own threads', () => {
    expect(review.conversation.map((c) => c.id)).toEqual(['106:1', '105:1', '105:2']);
    expect(review.conversation[0]!.url).toContain('_a=overview&discussionId=106');
  });

  it('lists the paths threads sit on', () => {
    expect(threadPaths(threadsFixture)).toEqual([
      'src/app/moved.ts',
      'src/app/unmoved.ts',
      'src/app/deleted.ts',
    ]);
  });
});

describe('newestDate', () => {
  it('picks the newest parseable date, as given', () => {
    expect(newestDate(['2026-01-02T00:00:00Z', undefined, 'x', '2026-03-01T00:00:00.000Z'])).toBe(
      '2026-03-01T00:00:00.000Z',
    );
    expect(newestDate([null, ''])).toBe('');
  });
});

describe('ADO request bodies', () => {
  it('anchors a new thread on the right side, ending one past the last line', () => {
    expect(
      adoThreadBody(
        { path: 'src/a.ts', startLine: 10, endLine: 14, body: 'Hm' },
        { iteration: 11, changeTrackingId: 7, lastLineLength: 22 },
      ),
    ).toEqual({
      comments: [{ parentCommentId: 0, content: 'Hm', commentType: 1 }],
      status: 1,
      threadContext: {
        filePath: '/src/a.ts',
        rightFileStart: { line: 10, offset: 1 },
        rightFileEnd: { line: 14, offset: 23 },
      },
      pullRequestThreadContext: {
        changeTrackingId: 7,
        iterationContext: { firstComparingIteration: 11, secondComparingIteration: 11 },
      },
    });
    expect(
      adoThreadBody(
        { path: 'b.ts', startLine: 1, endLine: 1, body: 'x' },
        { iteration: 1, lastLineLength: 0 },
      ),
    ).not.toHaveProperty('pullRequestThreadContext');
  });

  it("replies under the thread's first comment, and posts the summary closed", () => {
    expect(adoReplyBody('ok', 3)).toEqual({ content: 'ok', parentCommentId: 3, commentType: 1 });
    const thread = (comments: object[]) => ({ comments });
    expect(adoRootCommentId(threadsFixture.value[0])).toBe(1);
    expect(
      adoRootCommentId(
        thread([
          { id: 7, parentCommentId: 4 },
          { id: 4, parentCommentId: 0 },
        ]),
      ),
    ).toBe(4);
    expect(adoRootCommentId(thread([{ id: 9, parentCommentId: 2 }]))).toBe(9);
    expect(() => adoRootCommentId(thread([]))).toThrow();
    expect(adoSummaryBody('LGTM')).toEqual({
      comments: [{ parentCommentId: 0, content: 'LGTM', commentType: 1 }],
      status: 4,
    });
  });

  it('votes per verdict, and casts none for a comment', () => {
    expect(
      (
        ['approve', 'approve_with_suggestions', 'wait_for_author', 'reject', 'comment'] as const
      ).map(adoVote),
    ).toEqual([10, 5, -5, -10, null]);
  });

  it('maps change tracking ids by path', () => {
    const pages = [
      { changeEntries: [{ changeTrackingId: 1, item: { path: '/a.ts' } }] },
      { changeEntries: [{ changeTrackingId: 2, item: { path: '/b/c.ts' } }, { item: {} }] },
    ];
    expect(changeTrackingIds(pages)).toEqual(
      new Map([
        ['a.ts', 1],
        ['b/c.ts', 2],
      ]),
    );
  });

  it('tells a token without write access apart', () => {
    for (const status of [401, 403]) {
      expect(adoWriteError(new AdoRequestError('no', status)).kind).toBe('scope');
    }
    expect(adoWriteError(new AdoRequestError('Server error\nmore', 500))).toEqual({
      kind: 'other',
      message: 'Server error',
    });
    expect(adoWriteError(new Error('boom')).kind).toBe('other');
  });
});

type Call = { path: string; method: string; body?: unknown };

function fakeDeps(failOnCall?: number) {
  const calls: Call[] = [];
  const deps: AdoDeps = {
    request: async (_config, path, options) => {
      const method = options?.method ?? 'GET';
      calls.push({ path, method, body: options?.body });
      if (failOnCall !== undefined && calls.length === failOnCall)
        throw new AdoRequestError('Server error', 500);
      if (path.endsWith('/iterations')) return iterations;
      if (path.includes('/changes')) {
        return path.endsWith('$skip=0')
          ? { changeEntries: [{ changeTrackingId: 3, item: { path: '/src/a.ts' } }], nextSkip: 1 }
          : { changeEntries: [] };
      }
      if (path.includes('/threads?')) return threadsFixture;
      if (method === 'GET' && /\/threads\/\d+$/.test(path))
        return threadsFixture.value.find((t) => path.endsWith(`/threads/${t.id}`)) ?? {};
      if (path.endsWith('/comments'))
        return {
          id: 5,
          parentCommentId: 1,
          content: 'agreed',
          publishedDate: '2026-11-24T10:00:00Z',
          author: { displayName: 'Me' },
        };
      if (/pullRequests\/\d+$/.test(path)) return pr;
      return {};
    },
    getMyId: async () => 'me-id',
    ensureCommits: async () => {},
    filesAtCommit: async () => filesAtHead,
    showFile: async () => 'one\ntwo\nthree four\n',
    checks: async () => checks,
  };
  return { deps, calls };
}

const pctx = {
  cwd: '/repo',
  projectId: 'p1',
  remote: null,
  ado: {
    organizationUrl: 'https://dev.azure.com/org',
    project: 'My Proj',
    pat: 'x',
    repository: 'repo',
  },
};
const base = 'My%20Proj/_apis/git/repositories/repo/pullRequests/7204';
const submission: PrSubmission = {
  verdict: 'approve_with_suggestions',
  body: 'Looks fine',
  comments: [
    { draftId: 'd1', path: 'src/a.ts', startLine: 2, endLine: 3, body: 'range' },
    { draftId: 'd2', path: 'src/new.ts', startLine: 1, endLine: 1, body: 'not in changes' },
  ],
  replies: [{ draftId: 'd3', threadId: '101', body: 'agreed' }],
};

describe('adoProvider', () => {
  it('loads threads tracked onto the latest iteration', async () => {
    const { deps, calls } = fakeDeps();
    const review = await makeAdoProvider(deps).load(pctx, 7204);
    expect(calls.map((c) => c.path)).toContain(`${base}/threads?$iteration=11&$baseIteration=0`);
    expect(review.head).toBe('HEAD11');
    expect(review.checks).toEqual(checks);
  });

  it('fetches and names the target tip the PR was last merged against', async () => {
    const { deps } = fakeDeps();
    const fetched: string[][] = [];
    const withTip: AdoDeps = {
      ...deps,
      request: async (config, path, options) =>
        /pullRequests\/\d+$/.test(path)
          ? { ...pr, lastMergeTargetCommit: { commitId: 'TIP' } }
          : deps.request(config, path, options),
      ensureCommits: async (_cwd, shas) => void fetched.push(shas),
    };
    const review = await makeAdoProvider(withTip).load(pctx, 7204);
    expect(review.baseTip).toBe('TIP');
    expect(fetched).toEqual([[review.base, 'HEAD11', 'TIP']]);
  });

  it('posts comments, replies, the vote and the summary, in that order', async () => {
    const { deps, calls } = fakeDeps();
    expect(await makeAdoProvider(deps).submit(pctx, 7204, submission)).toEqual({
      postedDraftIds: ['d1', 'd2', 'd3'],
    });
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path.replace(base, '')}`)).toEqual([
      'POST /threads',
      'POST /threads',
      'POST /threads/101/comments',
      'PUT /reviewers/me-id',
      'POST /threads',
    ]);
    expect(writes[0]!.body).toMatchObject({
      threadContext: { rightFileEnd: { line: 3, offset: 11 } },
      pullRequestThreadContext: { changeTrackingId: 3 },
    });
    expect(writes[1]!.body).not.toHaveProperty('pullRequestThreadContext');
    expect(writes[2]!.body).toEqual(adoReplyBody('agreed', 1));
    expect(writes[3]!.body).toEqual({ vote: 5 });
    expect(writes[4]!.body).toEqual(adoSummaryBody('Looks fine'));
  });

  it('stops at the first failure and reports what posted', async () => {
    // GETs: iterations, changes ×2; then POST d1 (4), POST d2 (5), the
    // reply's thread (6), the reply (7) fails.
    const { deps } = fakeDeps(7);
    const result = await makeAdoProvider(deps).submit(pctx, 7204, submission);
    expect(result).toEqual({
      postedDraftIds: ['d1', 'd2'],
      error: { kind: 'other', message: 'Comments posted; Server error' },
    });
  });

  it('casts no vote for a plain comment', async () => {
    const { deps, calls } = fakeDeps();
    await makeAdoProvider(deps).submit(pctx, 7204, { ...submission, verdict: 'comment' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it("posts a reply at once under the thread's first comment", async () => {
    const { deps, calls } = fakeDeps();
    const comment = await makeAdoProvider(deps).reply(pctx, 7204, '101', 'agreed');
    expect(calls).toEqual([
      { path: `${base}/threads/101`, method: 'GET', body: undefined },
      {
        path: `${base}/threads/101/comments`,
        method: 'POST',
        body: adoReplyBody('agreed', 1),
      },
    ]);
    expect(comment).toEqual({
      id: '101:5',
      author: 'Me',
      body: 'agreed',
      createdAt: '2026-11-24T10:00:00Z',
      url: 'https://dev.azure.com/org/My Proj/_git/repo/pullrequest/7204?_a=files&discussionId=101',
    });
  });

  it('resolves and reactivates a thread', async () => {
    const { deps, calls } = fakeDeps();
    await makeAdoProvider(deps).setResolved(pctx, 7204, '101', true);
    await makeAdoProvider(deps).setResolved(pctx, 7204, '101', false);
    expect(calls).toEqual([
      { path: `${base}/threads/101`, method: 'PATCH', body: { status: 'fixed' } },
      { path: `${base}/threads/101`, method: 'PATCH', body: { status: 'active' } },
    ]);
  });
});
