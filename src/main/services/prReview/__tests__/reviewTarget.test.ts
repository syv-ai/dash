import { describe, it, expect, vi } from 'vitest';
import type { PrRef, PullRequest } from '../../../../shared/types';
import { effectiveReviewTarget, ownOpenPr, type ReviewTargetDeps } from '../reviewTarget';

const pr = (number: number, headRefName: string, state: PullRequest['state'] = 'open') =>
  ({ number, headRefName, state }) as PullRequest;

function deps(over: Partial<ReviewTargetDeps> = {}, stored: PrRef | null = null) {
  const openPrs = vi.fn(async () => ({
    provider: 'github' as const,
    prs: [pr(3, 'feat'), pr(8, 'feat'), pr(9, 'other')],
  }));
  const d: ReviewTargetDeps = {
    storedTarget: () => stored,
    getTask: (id) => (id === 't1' ? { projectId: 'p1', path: '/wt', branch: 'feat' } : undefined),
    openPrs,
    branchOf: async () => null,
    ...over,
  };
  return { d, openPrs };
}

describe('ownOpenPr', () => {
  it('is the newest open PR from the branch', () => {
    expect(ownOpenPr([pr(3, 'feat'), pr(8, 'feat'), pr(12, 'feat', 'merged')], 'feat')).toBe(8);
    expect(ownOpenPr([pr(3, 'other')], 'feat')).toBeNull();
  });
});

describe('effectiveReviewTarget', () => {
  it('is the picked PR, without asking the provider', async () => {
    const { d, openPrs } = deps({}, { provider: 'ado', number: 2 });
    expect(await effectiveReviewTarget('t1', d)).toEqual({ provider: 'ado', number: 2 });
    expect(openPrs).not.toHaveBeenCalled();
  });

  it("else the task's own open PR, from the branch its checkout is on now", async () => {
    expect(await effectiveReviewTarget('t1', deps().d)).toEqual({ provider: 'github', number: 8 });
    const moved = deps({ branchOf: async () => 'other' }).d;
    expect(await effectiveReviewTarget('t1', moved)).toEqual({ provider: 'github', number: 9 });
  });

  it('is null for an unknown task, no own PR, or a provider that fails', async () => {
    expect(await effectiveReviewTarget('t9', deps().d)).toBeNull();
    const none = deps({ branchOf: async () => 'lonely' }).d;
    expect(await effectiveReviewTarget('t1', none)).toBeNull();
    const failing = deps({
      openPrs: async () => {
        throw new Error('gh: not logged in');
      },
    }).d;
    expect(await effectiveReviewTarget('t1', failing)).toBeNull();
  });
});
