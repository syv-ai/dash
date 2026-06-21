import { describe, it, expect } from 'vitest';
import { mapAdoPrList, adoSourceBranchName } from '../adoPr';

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
        provider: 'ado',
      },
    ]);
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
