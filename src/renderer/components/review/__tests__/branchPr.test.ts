import { describe, expect, it } from 'vitest';
import type { PullRequestInfo, RelevantPr } from '../../../../shared/types';
import { branchPr } from '../branchPr';

const listed = (number: number): RelevantPr => ({
  number,
  title: `PR ${number}`,
  url: '',
  state: 'open',
  author: 'a',
  headRefName: 'feat',
  baseRefName: 'main',
  provider: 'github',
  fromFork: false,
  draft: false,
  updatedAt: null,
  additions: null,
  deletions: null,
  threads: null,
  ci: null,
  viewer: null,
  issues: null,
  verdict: null,
  headUrl: null,
});
const detected = (number: number, state: PullRequestInfo['state'] = 'open'): PullRequestInfo => ({
  number,
  title: `PR ${number}`,
  url: '',
  state,
  provider: 'github',
});

describe('branchPr', () => {
  it('is the newest PR the relevant listing has from the branch', () => {
    const relevant = { branch: 'feat', from: [listed(9), listed(4)], into: [] };
    expect(branchPr(relevant, [detected(4)])?.number).toBe(9);
  });

  it('is none when the listing has none from the branch, whatever the lookup says', () => {
    expect(branchPr({ branch: 'feat', from: [], into: [listed(2)] }, [detected(4)])).toBeNull();
  });

  it("falls back to the lookup's open PR until the listing lands", () => {
    expect(branchPr(null, [detected(4)])?.number).toBe(4);
    expect(branchPr(null, [detected(4, 'merged')])).toBeNull();
    expect(branchPr(null, undefined)).toBeNull();
  });
});
