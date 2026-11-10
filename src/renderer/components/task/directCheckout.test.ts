import { describe, it, expect } from 'vitest';
import { isDirectCheckout } from './directCheckout';

describe('isDirectCheckout', () => {
  it('new branch in a worktree is cut from origin/<name>, so local state is not used', () => {
    expect(isDirectCheckout({ createNewBranch: true, useWorktree: true })).toBe(false);
  });

  it('checking out an existing branch uses local state', () => {
    expect(isDirectCheckout({ createNewBranch: false, useWorktree: true })).toBe(true);
    expect(isDirectCheckout({ createNewBranch: false, useWorktree: false })).toBe(true);
  });

  it('new branch without a worktree switches the project checkout directly', () => {
    expect(isDirectCheckout({ createNewBranch: true, useWorktree: false })).toBe(true);
  });
});
