import { describe, it, expect } from 'vitest';
import { adoThreadOrigins, linesChanged, makeAdoProvider, type AdoDeps } from '../ado';

const iterations = {
  value: [
    { id: 1, sourceRefCommit: { commitId: 'c1' }, commonRefCommit: { commitId: 'b' } },
    { id: 2, sourceRefCommit: { commitId: 'c2' }, commonRefCommit: { commitId: 'b' } },
    { id: 3, sourceRefCommit: { commitId: 'c3' }, commonRefCommit: { commitId: 'b' } },
  ],
};
const said = [{ id: 1, content: 'Hm', commentType: 'text' }];
/** A thread on the PR's side, as `threads?$iteration=3` answers it (documented shape). */
const thread = (id: number, leftOn: number, over: Record<string, unknown> = {}) => ({
  id,
  status: 'active',
  threadContext: {
    filePath: '/src/a.ts',
    rightFileStart: { line: 20, offset: 1 },
    rightFileEnd: { line: 22, offset: 5 },
  },
  pullRequestThreadContext: {
    iterationContext: { firstComparingIteration: leftOn, secondComparingIteration: leftOn },
  },
  comments: said,
  ...over,
});

describe('adoThreadOrigins', () => {
  it("places an earlier iteration's thread where it was left, tracked or not", () => {
    const tracked = thread(2, 1, {
      pullRequestThreadContext: {
        iterationContext: { firstComparingIteration: 1, secondComparingIteration: 1 },
        trackingCriteria: {
          firstComparingIteration: 3,
          secondComparingIteration: 3,
          origFilePath: '/src/old.ts',
          origRightFileStart: { line: 10, offset: 1 },
          origRightFileEnd: { line: 12, offset: 5 },
        },
      },
    });
    expect(adoThreadOrigins({ value: [thread(1, 2), tracked] }, iterations, 3)).toEqual([
      { threadId: '1', commit: 'c2', path: 'src/a.ts', headPath: 'src/a.ts', start: 20, end: 22 },
      { threadId: '2', commit: 'c1', path: 'src/old.ts', headPath: 'src/a.ts', start: 10, end: 12 },
    ]);
  });

  it("leaves out the latest iteration's threads, the base side, unknown iterations and ADO's own", () => {
    const left = thread(4, 1, {
      threadContext: {
        filePath: '/src/a.ts',
        leftFileStart: { line: 3 },
        leftFileEnd: { line: 3 },
      },
    });
    const system = thread(5, 1, { properties: { CodeReviewThreadType: 'VoteUpdate' } });
    const general = { id: 6, comments: said };
    expect(
      adoThreadOrigins(
        { value: [thread(3, 3), left, thread(7, 9), system, general] },
        iterations,
        3,
      ),
    ).toEqual([]);
  });
});

describe('linesChanged', () => {
  const diff = (...hunks: string[]) =>
    ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', ...hunks].join('\n');

  it('sees a rewrite or removal of the lines', () => {
    expect(linesChanged(diff('@@ -21 +21 @@', '-x', '+y'), 20, 22)).toBe(true);
    expect(linesChanged(diff('@@ -18,3 +18,0 @@'), 20, 22)).toBe(true);
  });

  it('sees lines added inside the range, not right after it', () => {
    expect(linesChanged(diff('@@ -20,0 +21,2 @@'), 20, 22)).toBe(true);
    expect(linesChanged(diff('@@ -22,0 +23 @@'), 20, 22)).toBe(false);
  });

  it('reads lines that only moved as unchanged', () => {
    expect(linesChanged(diff('@@ -5,0 +6,4 @@', '@@ -40,2 +44,2 @@'), 20, 22)).toBe(false);
    expect(linesChanged('', 20, 22)).toBe(false);
  });
});

describe('the ADO review, outdated threads', () => {
  const ctx = {
    cwd: '/repo',
    projectId: 'p1',
    remote: null,
    ado: {
      organizationUrl: 'https://dev.azure.com/org',
      project: 'Proj',
      pat: 'x',
      repository: 'repo',
    },
  };

  function deps(diffs: Record<string, string>, unreachable: string[] = []) {
    const asked: string[][] = [];
    const d: AdoDeps = {
      request: async (_c, path) => {
        if (path.endsWith('/iterations')) return iterations;
        if (path.includes('/threads?'))
          return { value: [thread(1, 1), thread(2, 2), thread(3, 3), thread(4, 1)] };
        if (/pullRequests\/\d+$/.test(path)) return { pullRequestId: 7, status: 'active' };
        return {};
      },
      getMyId: async () => '',
      ensureCommits: async (_cwd, shas) => {
        if (shas.some((s) => unreachable.includes(s))) throw new Error('gone');
      },
      filesAtCommit: async () => new Set(['src/a.ts']),
      showFile: async () => '',
      checks: async () => [],
      fetchBranch: async () => {},
      diffStat: async () => null,
      diffHunks: async (_cwd, from, _to, paths) => {
        asked.push([from, ...paths]);
        return diffs[from] ?? '';
      },
    };
    return { d, asked };
  }

  it('marks a thread outdated once its lines changed since it was left, one diff per commit', async () => {
    const { d, asked } = deps({ c1: '@@ -21 +21 @@', c2: '@@ -1,0 +2,3 @@' });
    const review = await makeAdoProvider(d).load(ctx, 7);
    expect(review.threads.map((t) => [t.id, t.isOutdated, t.line])).toEqual([
      ['1', true, null],
      ['2', false, 22],
      ['3', false, 22],
      ['4', true, null],
    ]);
    expect(asked).toEqual([
      ['c1', 'src/a.ts'],
      ['c2', 'src/a.ts'],
    ]);
  });

  it("leaves a thread as it was when the commit it was left on can't be fetched", async () => {
    const { d } = deps({ c1: '@@ -21 +21 @@' }, ['c1']);
    const review = await makeAdoProvider(d).load(ctx, 7);
    expect(review.threads.find((t) => t.id === '1')?.isOutdated).toBe(false);
  });
});
