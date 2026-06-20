import { describe, it, expect } from 'vitest';
import { getTaskCreatability } from './taskModalCreatability';

const base = {
  gitReady: true,
  branchFetchDone: true,
  branchError: false,
  branchCount: 2,
  hasSelectedBranch: true,
};

describe('getTaskCreatability', () => {
  it('non-git project: no commit/branch gating at all', () => {
    expect(
      getTaskCreatability({ ...base, gitReady: false, branchCount: 0, hasSelectedBranch: false }),
    ).toEqual({ repoHasNoCommits: false, requiresBranchSelection: false });
  });

  it('git repo with commits + a selected branch: creatable, no gating', () => {
    expect(getTaskCreatability(base)).toEqual({
      repoHasNoCommits: false,
      requiresBranchSelection: false,
    });
  });

  it('git repo with branches but none selected: must select a branch', () => {
    expect(getTaskCreatability({ ...base, hasSelectedBranch: false })).toEqual({
      repoHasNoCommits: false,
      requiresBranchSelection: true,
    });
  });

  it('fresh git repo, fetch done, zero branches: in-place, no branch required', () => {
    expect(
      getTaskCreatability({
        gitReady: true,
        branchFetchDone: true,
        branchError: false,
        branchCount: 0,
        hasSelectedBranch: false,
      }),
    ).toEqual({ repoHasNoCommits: true, requiresBranchSelection: false });
  });

  it('git repo, fetch not finished yet: block until we know the branch set', () => {
    expect(
      getTaskCreatability({
        gitReady: true,
        branchFetchDone: false,
        branchError: false,
        branchCount: 0,
        hasSelectedBranch: false,
      }),
    ).toEqual({ repoHasNoCommits: false, requiresBranchSelection: true });
  });

  it('git repo, fetch errored with no branches: block (unknown state, not "empty repo")', () => {
    expect(
      getTaskCreatability({
        gitReady: true,
        branchFetchDone: true,
        branchError: true,
        branchCount: 0,
        hasSelectedBranch: false,
      }),
    ).toEqual({ repoHasNoCommits: false, requiresBranchSelection: true });
  });
});
