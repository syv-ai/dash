import { describe, expect, it } from 'vitest';
import type { PrRef, PullRequest, RelevantPrs } from '../../../../shared/types';
import {
  defaultReviewPr,
  reviewModeHolds,
  settleReviewMode,
  type ReviewModeDeps,
} from '../reviewMode';
import { listRelevantPrs } from '../relevantPrs';

const pr = (number: number, provider: PullRequest['provider'] = 'github') =>
  ({ number, provider }) as PullRequest;
const relevant = (from: number[], into: number[] = []): RelevantPrs => ({
  branch: 'feat',
  from: from.map((n) => pr(n)),
  into: into.map((n) => pr(n)),
});

function deps(stored: PrRef | null, listing: RelevantPrs | Error) {
  let mode = stored;
  const d: ReviewModeDeps = {
    storedMode: () => mode,
    storeMode: (_id, p) => void (mode = p),
    relevantPrs: async () => {
      if (listing instanceof Error) throw listing;
      return listing;
    },
  };
  return { d, mode: () => mode };
}

const gh = (number: number): PrRef => ({ provider: 'github', number });

describe('reviewModeHolds', () => {
  it('holds for an open PR from or into the branch, on the same provider', () => {
    expect(reviewModeHolds(gh(3), relevant([3]))).toBe(true);
    expect(reviewModeHolds(gh(7), relevant([3], [7]))).toBe(true);
    expect(reviewModeHolds(gh(9), relevant([3], [7]))).toBe(false);
    expect(reviewModeHolds({ provider: 'ado', number: 3 }, relevant([3]))).toBe(false);
  });
});

describe('settleReviewMode', () => {
  it('keeps a mode that holds, with the relevant PRs', async () => {
    const { d, mode } = deps(gh(7), relevant([3], [7]));
    expect(await settleReviewMode('t', d)).toEqual({ relevant: relevant([3], [7]), mode: gh(7) });
    expect(mode()).toEqual(gh(7));
  });

  it('ends a mode whose PR merged, closed, or left the branch', async () => {
    const { d, mode } = deps(gh(9), relevant([3]));
    expect((await settleReviewMode('t', d)).mode).toBeNull();
    expect(mode()).toBeNull();
  });

  it('keeps the stored mode when the forge cannot be asked', async () => {
    const { d, mode } = deps(gh(9), new Error('offline'));
    expect(await settleReviewMode('t', d)).toEqual({ relevant: null, mode: gh(9) });
    expect(mode()).toEqual(gh(9));
  });
});

describe('defaultReviewPr', () => {
  it('is the review-mode PR, else the newest PR from the branch, else null', async () => {
    expect(await defaultReviewPr('t', deps(gh(7), relevant([3], [7])).d)).toEqual(gh(7));
    expect(await defaultReviewPr('t', deps(null, relevant([5, 3], [7])).d)).toEqual(gh(5));
    expect(await defaultReviewPr('t', deps(null, relevant([], [7])).d)).toBeNull();
  });

  it('falls back to the own PR once a stale mode ends', async () => {
    const { d, mode } = deps(gh(9), relevant([3]));
    expect(await defaultReviewPr('t', d)).toEqual(gh(3));
    expect(mode()).toBeNull();
  });

  it("never picks a fork's PR from a same-named branch", async () => {
    const listed = (number: number, fromFork: boolean) =>
      ({
        number,
        provider: 'github',
        state: 'open',
        headRefName: 'feat',
        baseRefName: 'main',
        fromFork,
      }) as PullRequest;
    const d: ReviewModeDeps = {
      storedMode: () => null,
      storeMode: () => undefined,
      relevantPrs: () =>
        listRelevantPrs(async (f) => (f.head ? [listed(8, true), listed(4, false)] : []), 'feat'),
    };
    expect(await defaultReviewPr('t', d)).toEqual(gh(4));
  });

  it("answers the stored mode offline, else the forge's error", async () => {
    expect(await defaultReviewPr('t', deps(gh(9), new Error('offline')).d)).toEqual(gh(9));
    await expect(defaultReviewPr('t', deps(null, new Error('offline')).d)).rejects.toThrow(
      'offline',
    );
  });
});
