import { describe, it, expect, vi } from 'vitest';
import { loadPrDetails, loadPrReview } from '../loadReview';
import type { ForgeDetails, ForgeReview } from '../types';
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

describe('loadPrDetails', () => {
  it("stamps the forge's capabilities on the provider's details", async () => {
    const forge = { head: 'H', title: 'x', threads: [] } as unknown as ForgeDetails;
    const details = vi.fn(async () => forge);
    const ctx = { cwd: '/repo', projectId: 'p1', remote: null };
    const capabilities = FORGE_CAPABILITIES.ado;
    expect(await loadPrDetails({ details, capabilities }, ctx, 4)).toEqual({
      ...forge,
      capabilities,
    });
    expect(details).toHaveBeenCalledWith(ctx, 4);
  });
});
