import { describe, it, expect, vi } from 'vitest';
import type { PrRef, PullRequest } from '../../../../shared/types';
import {
  effectiveReviewTarget,
  ownOpenPr,
  pickReviewTarget,
  type ReviewTargetDeps,
} from '../reviewTarget';

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
    expect(await effectiveReviewTarget('t1', d)).toEqual({
      provider: 'ado',
      number: 2,
      source: 'stored',
    });
    expect(openPrs).not.toHaveBeenCalled();
  });

  it("else the task's own open PR, from the branch its checkout is on now", async () => {
    const own = { provider: 'github', source: 'own' };
    expect(await effectiveReviewTarget('t1', deps().d)).toEqual({ ...own, number: 8 });
    const moved = deps({ branchOf: async () => 'other' }).d;
    expect(await effectiveReviewTarget('t1', moved)).toEqual({ ...own, number: 9 });
  });

  it('is null for an unknown task or no own PR', async () => {
    expect(await effectiveReviewTarget('t9', deps().d)).toBeNull();
    const none = deps({ branchOf: async () => 'lonely' }).d;
    expect(await effectiveReviewTarget('t1', none)).toBeNull();
  });

  it('rejects when the provider can\'t be asked: that isn\'t "no PR"', async () => {
    const failing = deps({
      openPrs: async () => {
        throw new Error('gh: not logged in');
      },
    }).d;
    await expect(effectiveReviewTarget('t1', failing)).rejects.toThrow('gh: not logged in');
  });
});

describe('pickReviewTarget', () => {
  function picking(over: Partial<ReviewTargetDeps> = {}) {
    let stored: PrRef | null = { provider: 'github', number: 3 };
    const d = {
      ...deps(over).d,
      storedTarget: () => stored,
      store: (_id: string, t: PrRef | null) => void (stored = t),
    };
    return { d, stored: () => stored };
  }

  it('stores a PR other than the own one, and answers it', async () => {
    const { d, stored } = picking();
    const pr = { provider: 'github' as const, number: 9 };
    expect(await pickReviewTarget('t1', pr, d)).toEqual({ ...pr, source: 'stored' });
    expect(stored()).toEqual(pr);
  });

  it("never stores the task's own PR: picking it clears the pick", async () => {
    const { d, stored } = picking();
    const own = { provider: 'github' as const, number: 8 };
    expect(await pickReviewTarget('t1', own, d)).toEqual({ ...own, source: 'own' });
    expect(stored()).toBeNull();
  });

  it("stores the pick as given when the own PR can't be told", async () => {
    const { d, stored } = picking({
      openPrs: async () => {
        throw new Error('offline');
      },
    });
    const pr = { provider: 'github' as const, number: 8 };
    expect(await pickReviewTarget('t1', pr, d)).toEqual({ ...pr, source: 'stored' });
    expect(stored()).toEqual(pr);
  });

  it('clears the pick on null', async () => {
    const { d, stored } = picking();
    expect(await pickReviewTarget('t1', null, d)).toEqual({
      provider: 'github',
      number: 8,
      source: 'own',
    });
    expect(stored()).toBeNull();
  });
});
