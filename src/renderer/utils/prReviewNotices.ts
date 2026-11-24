import type { PrReview, PrReviewThread } from '../../shared/types';

/** The threads still open: what prompts, counts and the new-comment toast are about. */
export function unresolvedThreads(review: Pick<PrReview, 'threads'>): PrReviewThread[] {
  return review.threads.filter((t) => !t.resolved);
}

/** Per task, the PR last looked at and the ids of its review comments seen so far. */
export interface SeenReview {
  pr: number;
  ids: string[];
}

/**
 * The unresolved threads of `review` with comments not in `seen`, and what to
 * remember next. The first look at a PR only records its comments, so opening
 * Dash on an old PR doesn't announce its whole history. Ids are only added,
 * so a thread resolved and reopened later isn't announced again.
 */
export function newReviewComments(
  seen: SeenReview | undefined,
  review: PrReview,
): { threads: PrReviewThread[]; count: number; next: SeenReview } {
  const open = unresolvedThreads(review);
  const ids = open.flatMap((t) => t.comments.map((c) => c.id));
  if (!seen || seen.pr !== review.number) {
    return { threads: [], count: 0, next: { pr: review.number, ids } };
  }
  const known = new Set(seen.ids);
  const threads = open.filter((t) => t.comments.some((c) => !known.has(c.id)));
  const count = ids.filter((id) => !known.has(id)).length;
  return { threads, count, next: { pr: review.number, ids: [...new Set([...seen.ids, ...ids])] } };
}

/** "path:start-end", with why there is no usable line when there isn't. */
export function threadLocation(t: PrReviewThread): string {
  if (t.line === null) return `${t.path} (${t.isOutdated ? 'outdated' : 'file'})`;
  const lines = t.startLine && t.startLine !== t.line ? `${t.startLine}-${t.line}` : `${t.line}`;
  return `${t.path}:${lines}${t.side === 'LEFT' ? ' (removed line)' : ''}`;
}
