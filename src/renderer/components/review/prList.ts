import type { PrReview, RelevantPr, RelevantPrs } from '../../../shared/types';
import { OWN_REVIEW_LABELS } from './finishReview';

/** Which end of a PR the task's branch is: its head (`from`) or its base (`into`). */
export type PrSide = 'from' | 'into';

/** A PR the PRs view lists, and which end of it the branch is. */
export interface ListedPr {
  pr: RelevantPr;
  side: PrSide;
}

/**
 * The PRs view's drawers, in order: the branch's own PRs first (opened from
 * it), then those into it, each newest first as the forge listed them. Empty
 * until listed.
 */
export function taskPrList(relevant: RelevantPrs | null): ListedPr[] {
  if (!relevant) return [];
  return [
    ...relevant.from.map((pr) => ({ pr, side: 'from' as const })),
    ...relevant.into.map((pr) => ({ pr, side: 'into' as const })),
  ];
}

/** The PRs tab is there only while the branch has PRs from or into it. */
export const prsTabShown = (relevant: RelevantPrs | null): boolean =>
  taskPrList(relevant).length > 0;

/** One way the person is part of a PR, as its drawer's "You" row says it. */
export interface Involvement {
  key: 'author' | 'assignee' | 'requested' | 'reviewed' | 'commented';
  label: string;
  /** What the badge's tooltip adds. */
  title: string;
}

/**
 * How the person is part of a PR, in the order the forge's sidebar reads:
 * they opened it, are assigned to it (GitHub only; ADO has no assignees),
 * are asked to review it, reviewed it (their verdict, and whether commits
 * have landed since), or commented on it. A review that was itself a comment
 * says "Commented" once. Empty when they aren't part of it.
 */
export function prInvolvement(
  review: Pick<
    PrReview,
    | 'viewerIsAuthor'
    | 'viewerIsAssignee'
    | 'viewerIsRequestedReviewer'
    | 'viewerReview'
    | 'viewerCommented'
  >,
): Involvement[] {
  const out: Involvement[] = [];
  if (review.viewerIsAuthor) out.push({ key: 'author', label: 'Author', title: 'You opened it' });
  if (review.viewerIsAssignee)
    out.push({ key: 'assignee', label: 'Assigned', title: "You're assigned to it" });
  if (review.viewerIsRequestedReviewer)
    out.push({
      key: 'requested',
      label: 'Review requested',
      title: "You're asked to review it and haven't yet",
    });
  const own = review.viewerReview;
  if (own) {
    const label = OWN_REVIEW_LABELS[own.state];
    out.push({
      key: 'reviewed',
      label: own.stale ? `${label} · new commits since` : label,
      title: own.stale
        ? 'Your last review; commits have landed on it since'
        : 'Your last review, at its head',
    });
  }
  if (review.viewerCommented && own?.state !== 'commented')
    out.push({ key: 'commented', label: 'Commented', title: "You've commented on it" });
  return out;
}

/** How long a drawer's details stay fresh before opening it fetches them again. */
export const DETAILS_FRESH_MS = 2 * 60_000;

/** When a PR's details were last fetched, and its update time then. */
export interface DetailsFetch {
  at: number;
  updatedAt: string | null;
}

/**
 * Whether opening a PR's drawer fetches its details (the full review): never
 * fetched, the listing says it has moved since (GitHub's update time; ADO
 * lists none), or fetched longer than `DETAILS_FRESH_MS` ago. `now` in ms.
 */
export function needsDetails(
  last: DetailsFetch | undefined,
  updatedAt: string | null,
  now: number,
): boolean {
  if (!last) return true;
  if (updatedAt !== null && updatedAt !== last.updatedAt) return true;
  return now - last.at > DETAILS_FRESH_MS;
}
