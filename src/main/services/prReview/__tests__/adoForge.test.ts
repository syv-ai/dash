import { describe, it, expect } from 'vitest';
import type { PrCheck } from '../../../../shared/types';
import timeline from '../../__tests__/fixtures/ado-build-timeline.json';
import { adoBranchPrFrom, adoRowFacts, makeAdoProvider, type AdoDeps } from '../ado';

const repo = { organizationUrl: 'https://dev.azure.com/org', project: 'Proj', repository: 'repo' };
const ctx = { cwd: '/repo', projectId: 'p1', remote: null, ado: { ...repo, pat: 'x' } };

/** A `git/pullrequests` entry, as the list answers it (documented shape). */
const listed = (over: Record<string, unknown> = {}) => ({
  pullRequestId: 7,
  title: 'Wire inputs',
  status: 'active',
  isDraft: false,
  sourceRefName: 'refs/heads/feature/x',
  targetRefName: 'refs/heads/main',
  createdBy: { displayName: 'Bo' },
  repository: { project: { id: 'proj-id' } },
  lastMergeSourceCommit: { commitId: 'head7' },
  lastMergeTargetCommit: { commitId: 'main7' },
  ...over,
});

function deps(answers: Record<string, unknown>, checks: PrCheck[] = []) {
  const asked: string[] = [];
  const fetched: string[] = [];
  const d: AdoDeps = {
    request: async (_c, path) => {
      asked.push(path);
      const key = Object.keys(answers).find((k) => path.includes(k));
      return key ? answers[key] : {};
    },
    getMyId: async () => 'me',
    ensureCommits: async () => {},
    filesAtCommit: async () => new Set(),
    showFile: async () => '',
    checks: async () => checks,
    fetchBranch: async (_cwd, branch) => {
      fetched.push(branch);
    },
    diffStat: async () => ({ additions: 12, deletions: 3 }),
    diffHunks: async () => '',
  };
  return { d, asked, fetched };
}

describe('adoBranchPrFrom', () => {
  it('maps a listed PR, its head and CI', () => {
    expect(adoBranchPrFrom(listed(), repo, 'failing')).toEqual({
      number: 7,
      title: 'Wire inputs',
      url: 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/7',
      state: 'open',
      provider: 'ado',
      headSha: 'head7',
      ci: 'failing',
    });
  });

  it('reads a draft as open, and drops CI once merged or abandoned', () => {
    expect(adoBranchPrFrom(listed({ isDraft: true }), repo).state).toBe('open');
    expect(adoBranchPrFrom(listed({ status: 'completed' }), repo, 'passing')).toMatchObject({
      state: 'merged',
      ci: null,
    });
    expect(adoBranchPrFrom(listed({ status: 'abandoned' }), repo).state).toBe('closed');
  });
});

describe('the ADO forge', () => {
  it("lists a branch's PRs in any state, with CI on the open ones only", async () => {
    const { d, asked } = deps(
      { pullrequests: { value: [listed(), listed({ pullRequestId: 3, status: 'completed' })] } },
      [{ name: 'Build', state: 'failing', url: null }],
    );
    const prs = await makeAdoProvider(d).prsFrom(ctx, 'feature/x');
    expect(asked[0]).toContain('searchCriteria.sourceRefName=refs%2Fheads%2Ffeature%2Fx');
    expect(asked[0]).toContain('searchCriteria.status=all');
    expect(prs.map((p) => [p.number, p.state, p.ci])).toEqual([
      [7, 'open', 'failing'],
      [3, 'merged', null],
    ]);
  });

  it('lists the open PRs to start a task on', async () => {
    const { d, asked } = deps({ pullrequests: { value: [listed()] } });
    const prs = await makeAdoProvider(d).listOpen(ctx);
    expect(asked[0]).toContain('searchCriteria.status=active');
    expect(prs[0]).toMatchObject({ number: 7, headRefName: 'feature/x', baseRefName: 'main' });
  });

  it("fetches a PR's source branch for a task", async () => {
    const { d, fetched } = deps({});
    expect(await makeAdoProvider(d).prepareBranch(ctx, { number: 7, headRefName: 'f/x' })).toBe(
      'f/x',
    );
    expect(fetched).toEqual(['f/x']);
  });

  it('matches no commit author to a profile', async () => {
    expect(await makeAdoProvider(deps({}).d).commitAuthorUrl('/repo', 'abc')).toBeNull();
  });

  it('reports a failed build with its failed tasks, errors and the failing log', async () => {
    const build = 'Proj/_apis/build/builds/42';
    const { d, asked } = deps(
      {
        [`${build}/logs/5`]: '2026-11-27T10:00:01.3000000Z ##[error]Bash exited with code 1.',
        [`${build}/logs`]: { value: [{ id: 5, lineCount: 900 }] },
        [`${build}/timeline`]: timeline,
        [build]: { result: 'failed', definition: { name: 'CI' } },
      },
      [
        {
          name: 'Build CI',
          state: 'failing',
          url: 'https://dev.azure.com/org/Proj/_build/results?buildId=42',
        },
        { name: 'sonar/quality', state: 'failing', url: 'https://sonar/x' },
        { name: 'Lint', state: 'passing', url: null },
      ],
    );
    const checks = await makeAdoProvider(d).failedChecks(ctx, 7);
    expect(asked).toContain(`${build}/logs/5?startLine=501`);
    expect(checks).toEqual([
      {
        name: 'Build CI',
        state: 'failed',
        workflow: 'CI',
        link: 'https://dev.azure.com/org/Proj/_build/results?buildId=42',
        description: '',
        failedSteps: ['Linux / Lint', 'Linux / npm test'],
        annotations: [
          'error src/a.test.ts:12: Expected 2 to be 3',
          "error Bash exited with code '1'.",
        ],
        log: '##[error]Bash exited with code 1.',
        notice: undefined,
      },
      {
        name: 'sonar/quality',
        state: 'failed',
        workflow: '',
        link: 'https://sonar/x',
        description: '',
        notice: 'Not an Azure Pipelines build; see the link.',
      },
    ]);
  });

  it("says so when a failing build's timeline can't be read", async () => {
    const { d } = deps({}, [
      {
        name: 'Build',
        state: 'failing',
        url: 'https://dev.azure.com/org/Proj/_build/results?buildId=9',
      },
    ]);
    d.request = async (_c, path) => {
      if (path.endsWith('/timeline')) throw new Error('gone');
      return {};
    };
    const [check] = await makeAdoProvider(d).failedChecks(ctx, 7);
    expect(check?.notice).toMatch(/timeline could not be fetched/);
  });

  it("fills a listing's rows with threads, activity, CI and line counts, a minute at a time", async () => {
    const threads = {
      value: [
        {
          id: 1,
          status: 'active',
          lastUpdatedDate: '2026-11-25T09:00:00Z',
          comments: [{ id: 1, content: 'Hm', commentType: 'text' }],
        },
        { id: 2, status: 'fixed', comments: [{ id: 1, content: 'Ok', commentType: 'text' }] },
        {
          id: 3,
          properties: { CodeReviewThreadType: { $value: 'RefUpdate' } },
          lastUpdatedDate: '2026-11-26T09:00:00Z',
          comments: [{ id: 1, commentType: 'system' }],
        },
      ],
    };
    const { d, asked } = deps(
      {
        '/threads': threads,
        pullrequests: { value: [listed({ creationDate: '2026-11-20T09:00:00Z' })] },
      },
      [{ name: 'Build', state: 'pending', url: null }],
    );
    const forge = makeAdoProvider(d);
    const [row] = await forge.list(ctx, { head: 'feature/x' });
    expect(row).toMatchObject({
      number: 7,
      updatedAt: '2026-11-26T09:00:00Z',
      threads: { open: 1, total: 2 },
      ci: 'pending',
      additions: 12,
      deletions: 3,
    });
    await forge.list(ctx, { head: 'feature/x' });
    expect(asked.filter((p) => p.endsWith('/threads'))).toHaveLength(1);
  });

  it('fills only the newest rows of a long listing', async () => {
    const many = Array.from({ length: 14 }, (_, i) => listed({ pullRequestId: i + 1 }));
    const { d, asked } = deps({ pullrequests: { value: many } });
    const rows = await makeAdoProvider(d).list(ctx, { base: 'main' });
    expect(asked.filter((p) => p.endsWith('/threads'))).toHaveLength(10);
    expect(rows.find((r) => r.number === 14)?.threads).not.toBeNull();
    expect(rows.find((r) => r.number === 1)).toMatchObject({
      threads: null,
      ci: null,
      additions: null,
    });
  });
});

describe('adoRowFacts', () => {
  it("counts people's threads, not ADO's own, and dates the PR by its newest activity", () => {
    expect(adoRowFacts({ creationDate: '2026-11-01T00:00:00Z' }, { value: [] })).toEqual({
      updatedAt: '2026-11-01T00:00:00Z',
      threads: { open: 0, total: 0 },
    });
  });
});
