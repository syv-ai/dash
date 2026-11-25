import { firstFitting } from '../ui/useFittedDensity';

/**
 * How the usage row gives way as it narrows, in order: it drops the pace,
 * then trades its rings for coloured percentages and drops the reset times.
 * Every limit keeps its tooltip throughout.
 */
export type UsageDensity = 'full' | 'noPace' | 'compact';

/** The measured rows, widest first; `compact` has none (it is the floor). */
export const USAGE_MEASURED = ['full', 'noPace'] as const;

/** Room a measured row must have beyond its natural width: it gives way
 *  while its rings still sit apart, before they read cramped. */
export const USAGE_COMFORT_PX = 32;

/** The first density whose natural width, plus `USAGE_COMFORT_PX`, fits
 *  `available`; `needs` holds the natural widths of `USAGE_MEASURED`, in
 *  that order. */
export function fitUsage(available: number, needs: readonly number[]): UsageDensity {
  return firstFitting(available - USAGE_COMFORT_PX, needs, USAGE_MEASURED) ?? 'compact';
}
