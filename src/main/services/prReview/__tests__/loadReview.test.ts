import { describe, it, expect, vi } from 'vitest';
import { loadPrReview } from '../loadReview';
import type { ForgeReview } from '../types';
import { FORGE_CAPABILITIES } from '../../../../shared/forgeCapabilities';

describe('loadPrReview', () => {
  it("adds local git's files, commits and distance behind base, and the forge's capabilities, to the provider's review", async () => {
    const forge = { base: 'B', head: 'H', baseRef: 'main', title: 'x' } as ForgeReview;
    const local = { files: [], commits: 2, behindBase: 5 };
    const stats = vi.fn(async () => local);
    const ctx = { cwd: '/wt', projectId: 'p1', remote: null };
    const load = async () => ({ ...forge, baseTip: 'T' });
    const capabilities = FORGE_CAPABILITIES.github;
    const review = await loadPrReview({ load, capabilities }, ctx, 4, stats);
    expect(stats).toHaveBeenCalledWith('/wt', { ...forge, baseTip: 'T' });
    expect(review).toEqual({ ...forge, capabilities, ...local });
  });
});
