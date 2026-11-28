import type { PrDetails, PrReview } from '@shared/types';
import { prLocalStats } from './localCommits';
import type { PrContext, ForgeProvider } from './types';

/**
 * A PR's full review: what its provider knows, plus what local git knows the
 * same way on every forge (files, commit count, distance behind base), and
 * the forge's capabilities. The provider has already fetched base, head and
 * the base tip into the checkout.
 */
export async function loadPrReview(
  adapter: Pick<ForgeProvider, 'load' | 'capabilities'>,
  ctx: PrContext,
  number: number,
  stats: typeof prLocalStats = prLocalStats,
): Promise<PrReview> {
  const { baseTip, ...review } = await adapter.load(ctx, number);
  return {
    ...review,
    capabilities: adapter.capabilities,
    ...(await stats(ctx.cwd, { ...review, baseTip })),
  };
}

/** A PR's details: what its provider tells of it with no git call, and the
 *  forge's capabilities. */
export async function loadPrDetails(
  adapter: Pick<ForgeProvider, 'details' | 'capabilities'>,
  ctx: PrContext,
  number: number,
): Promise<PrDetails> {
  return { ...(await adapter.details(ctx, number)), capabilities: adapter.capabilities };
}
