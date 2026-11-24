import { describe, it, expect, vi } from 'vitest';
import { loadPrReview } from '../loadReview';
import type { ForgeReview } from '../types';

describe('loadPrReview', () => {
  it("adds local git's files, commits and distance behind base to the provider's review", async () => {
    const forge = { base: 'B', head: 'H', baseRef: 'main', title: 'x' } as ForgeReview;
    const local = { files: [], commits: 2, behindBase: 5 };
    const stats = vi.fn(async () => local);
    const ctx = { cwd: '/wt', projectId: 'p1', remote: null };
    const review = await loadPrReview({ load: async () => forge }, ctx, 4, stats);
    expect(stats).toHaveBeenCalledWith('/wt', forge);
    expect(review).toEqual({ ...forge, ...local });
  });
});
