import type { PrReviewer } from './types';

/** Where a PR's review stands, at a glance: someone asked for changes, a
 *  required review is still to come or no one has approved yet, or it's
 *  approved. */
export type ReviewVerdict = 'changes_requested' | 'pending' | 'approved';

const APPROVING = new Set<PrReviewer['state']>(['approved', 'approved_with_suggestions']);
/** GitHub's change request; ADO's rejection and "waiting for author". */
const BLOCKING = new Set<PrReviewer['state']>(['changes_requested', 'rejected', 'waiting']);

/**
 * A PR's review verdict from its reviewers' states (GitHub's latest reviews,
 * ADO's votes), those who declined left out: changes requested if anyone
 * asked for them; else pending while a required reviewer hasn't approved;
 * else approved once anyone has; else pending while anyone is still asked.
 * Null with no one asked.
 */
export function reviewVerdict(reviewers: readonly PrReviewer[]): ReviewVerdict | null {
  const asked = reviewers.filter((r) => !r.declined);
  if (asked.some((r) => BLOCKING.has(r.state))) return 'changes_requested';
  if (asked.some((r) => r.required && !APPROVING.has(r.state))) return 'pending';
  if (asked.some((r) => APPROVING.has(r.state))) return 'approved';
  return asked.some((r) => r.state === 'pending') ? 'pending' : null;
}
