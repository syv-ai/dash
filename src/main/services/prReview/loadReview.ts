import type { PrReview } from '@shared/types';
import { prLocalStats } from './localCommits';
import type { PrContext, PrReviewProvider } from './types';

/**
 * A PR's full review: what its provider knows, plus what local git knows the
 * same way on every forge (files, commit count, distance behind base). The
 * provider has already fetched base and head into the checkout.
 */
export async function loadPrReview(
  adapter: Pick<PrReviewProvider, 'load'>,
  ctx: PrContext,
  number: number,
  stats: typeof prLocalStats = prLocalStats,
): Promise<PrReview> {
  const review = await adapter.load(ctx, number);
  return { ...review, ...(await stats(ctx.cwd, review)) };
}
