import { describe, it, expect } from 'vitest';
import { adoPrListQuery, mapAdoPrList, mapAdoRelevantPrs, adoSourceBranchName } from '../adoPr';

const ctx = {
  organizationUrl: 'https://dev.azure.com/myorg',
  project: 'MyProject',
  repository: 'MyRepo',
};

describe('adoSourceBranchName', () => {
  it('strips the refs/heads/ prefix', () => {
    expect(adoSourceBranchName('refs/heads/feature/x')).toBe('feature/x');
  });
  it('leaves an already-plain name unchanged', () => {
    expect(adoSourceBranchName('feature/x')).toBe('feature/x');
  });
});

describe('mapAdoPrList', () => {
  it('maps ADO PR REST value[] to open PullRequest[] with a built URL', () => {
    const value = [
      {
        pullRequestId: 7,
        title: 'Add widget',
        sourceRefName: 'refs/heads/feature/widget',
        targetRefName: 'refs/heads/main',
        status: 'active',
        createdBy: { displayName: 'Bob' },
      },
    ];
    expect(mapAdoPrList(value, ctx)).toEqual([
      {
        number: 7,
        title: 'Add widget',
        url: 'https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/7',
        state: 'open',
        author: 'Bob',
        headRefName: 'feature/widget',
        baseRefName: 'main',
        provider: 'ado',
        fromFork: false,
      },
    ]);
  });

  it('marks a PR whose source branch is in a fork', () => {
    const value = [
      { pullRequestId: 3, sourceRefName: 'refs/heads/b', forkSource: { name: 'refs/heads/b' } },
    ];
    expect(mapAdoPrList(value, ctx)[0]!.fromFork).toBe(true);
  });

  it('tolerates a trailing slash on organizationUrl and a missing author', () => {
    const value = [
      { pullRequestId: 1, title: 't', sourceRefName: 'refs/heads/b', status: 'active' },
    ];
    const out = mapAdoPrList(value, { ...ctx, organizationUrl: 'https://dev.azure.com/myorg/' });
    expect(out[0]!.url).toBe('https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/1');
    expect(out[0]!.author).toBe('');
  });

  it('returns [] for non-array input', () => {
    expect(mapAdoPrList(undefined, ctx)).toEqual([]);
  });
});

describe('adoPrListQuery', () => {
  it('asks for active PRs, narrowed by source and target ref', () => {
    expect(adoPrListQuery()).toBe('searchCriteria.status=active&$top=50');
    expect(adoPrListQuery({ head: 'feat/x', base: 'main' })).toBe(
      'searchCriteria.status=active&searchCriteria.sourceRefName=refs%2Fheads%2Ffeat%2Fx' +
        '&searchCriteria.targetRefName=refs%2Fheads%2Fmain&$top=50',
    );
  });
});

describe('mapAdoRelevantPrs', () => {
  it('adds the draft flag and leaves what the listing lacks null', () => {
    const value = [
      {
        pullRequestId: 7,
        title: 'Add widget',
        sourceRefName: 'refs/heads/feature/widget',
        targetRefName: 'refs/heads/main',
        createdBy: { displayName: 'Bob' },
        isDraft: true,
      },
    ];
    expect(mapAdoRelevantPrs(value, ctx)).toEqual([
      {
        ...mapAdoPrList(value, ctx)[0],
        draft: true,
        updatedAt: null,
        additions: null,
        deletions: null,
        threads: null,
        ci: null,
      },
    ]);
  });

  it('is empty for a missing value', () => {
    expect(mapAdoRelevantPrs(undefined, ctx)).toEqual([]);
  });
});
