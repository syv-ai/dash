import { firstFitting } from '../ui/useFittedDensity';

/**
 * How the usage row gives way as it narrows, in order: it drops the burn rate,
 * then trades its rings for coloured percentages and drops the reset times.
 * Every limit keeps its tooltip throughout.
 */
export type UsageDensity = 'full' | 'noBurn' | 'compact';

/** The measured rows, widest first; `compact` has none (it is the floor). */
export const USAGE_MEASURED = ['full', 'noBurn'] as const;

/** The first density whose natural width fits `available`; `needs` holds the
 *  natural widths of `USAGE_MEASURED`, in that order. */
export function fitUsage(available: number, needs: readonly number[]): UsageDensity {
  return firstFitting(available, needs, USAGE_MEASURED) ?? 'compact';
}
