import { describe, it, expect } from 'vitest';
import { mapGithubPrList, buildPrHeadRefspec, githubPrListArgs } from '../githubPr';

describe('mapGithubPrList', () => {
  it('maps gh pr list JSON to PullRequest[]', () => {
    const raw = [
      {
        number: 42,
        title: 'Fix auth',
        url: 'https://github.com/o/r/pull/42',
        state: 'OPEN',
        headRefName: 'fix/auth',
        baseRefName: 'main',
        author: { login: 'alice', name: 'Alice' },
        isCrossRepository: false,
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
        baseRefName: 'main',
        provider: 'github',
        fromFork: false,
      },
    ]);
  });

  it('marks a PR whose head is in a fork, and asks gh whether it is', () => {
    const raw = [{ number: 7, state: 'OPEN', headRefName: 'feat', isCrossRepository: true }];
    expect(mapGithubPrList(raw)[0]!.fromFork).toBe(true);
    expect(githubPrListArgs().join(' ')).toContain('isCrossRepository');
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

describe('githubPrListArgs', () => {
  it('lists open PRs, narrowed to a head or base branch when asked', () => {
    expect(githubPrListArgs()).not.toContain('--head');
    const args = githubPrListArgs({ head: 'feat/x', base: 'main' });
    expect(args.slice(0, 4)).toEqual(['pr', 'list', '--state', 'open']);
    expect(args.join(' ')).toContain('--head feat/x --base main');
  });
});
