import { describe, it, expect } from 'vitest';
import { forkPrOfBranch, prTaskBranch } from '../prBranch';

describe('prTaskBranch', () => {
  it("names a fork PR's task branch apart from origin's branches, a same-repo PR's by its head", () => {
    expect(prTaskBranch({ number: 7, headRefName: 'main', fromFork: true })).toBe('pr/7/main');
    expect(prTaskBranch({ number: 7, headRefName: 'fix/typo', fromFork: false })).toBe('fix/typo');
  });
});

describe('forkPrOfBranch', () => {
  it('reads the PR back from a fork task branch, and nothing from any other name', () => {
    expect(forkPrOfBranch('pr/7/fix/typo')).toEqual({ number: 7, headRefName: 'fix/typo' });
    for (const b of ['fix/typo', 'pr/x/y', 'pr/7', 'pr/7/', 'my/pr/7/x']) {
      expect(forkPrOfBranch(b)).toBeNull();
    }
  });
});
