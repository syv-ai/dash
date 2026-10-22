import { describe, it, expect } from 'vitest';
import type { PullRequest } from '../../../../../shared/types';
import { relevantPrs } from '../relevantPrs';

const pr = (number: number, headRefName: string, baseRefName = 'main'): PullRequest => ({
  number,
  title: '',
  url: '',
  state: 'open',
  author: '',
  headRefName,
  baseRefName,
  provider: 'github',
});

describe('relevantPrs', () => {
  it("keeps PRs from the branch or into it, on ADO's full refs too", () => {
    const prs = [
      pr(1, 'feat'),
      pr(2, 'other'),
      pr(3, 'child', 'feat'),
      pr(4, 'refs/heads/feat', 'refs/heads/main'),
    ];
    expect(relevantPrs(prs, 'feat').map((p) => p.number)).toEqual([1, 3, 4]);
  });
});
