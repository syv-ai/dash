import { describe, it, expect } from 'vitest';
import { mapGithubPrList, buildPrHeadRefspec } from '../githubPr';

describe('mapGithubPrList', () => {
  it('maps gh pr list JSON to PullRequest[]', () => {
    const raw = [
      {
        number: 42,
        title: 'Fix auth',
        url: 'https://github.com/o/r/pull/42',
        state: 'OPEN',
        headRefName: 'fix/auth',
        author: { login: 'alice', name: 'Alice' },
      },
    ];
    expect(mapGithubPrList(raw)).toEqual([
      {
        number: 42,
        title: 'Fix auth',
        url: 'https://github.com/o/r/pull/42',
        state: 'open',
        author: 'alice',
        headRefName: 'fix/auth',
        provider: 'github',
      },
    ]);
  });

  it('maps MERGED/CLOSED states and tolerates a missing author', () => {
    const raw = [
      { number: 1, title: 'a', url: 'u', state: 'MERGED', headRefName: 'b', author: null },
      { number: 2, title: 'c', url: 'v', state: 'CLOSED', headRefName: 'd' },
    ];
    const out = mapGithubPrList(raw);
    expect(out[0]!.state).toBe('merged');
    expect(out[0]!.author).toBe('');
    expect(out[1]!.state).toBe('closed');
  });

  it('returns [] for non-array input', () => {
    expect(mapGithubPrList(null)).toEqual([]);
    expect(mapGithubPrList({})).toEqual([]);
  });
});

describe('buildPrHeadRefspec', () => {
  it('builds the refs/pull head refspec into a local branch', () => {
    expect(buildPrHeadRefspec(42, 'fix/auth')).toBe('pull/42/head:fix/auth');
  });
});
