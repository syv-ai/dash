import type { PrReview, RelevantPr, RelevantPrs } from '../../../shared/types';
import { githubProfileUrl } from '../../../shared/urls';
import { shownPrState } from '../ui/prStatusColors';
import { OWN_REVIEW_LABELS } from './finishReview';

/**
 * The PRs view's PRs, in order: the branch's own PRs first (opened from it),
 * then those into it, each newest first as the forge listed them. Empty
 * until listed.
 */
export function taskPrList(relevant: RelevantPrs | null): RelevantPr[] {
  return relevant ? [...relevant.from, ...relevant.into] : [];
}

/** What a PR's head (`ReviewHeader`) says of it: a review has it all; a
 *  listed PR not yet fetched has no commit count. */
export type PrHead = Pick<
  PrReview,
  'provider' | 'number' | 'title' | 'url' | 'state' | 'author' | 'authorUrl' | 'baseRef' | 'headRef'
> & { commits: number | null };

/**
 * A listed PR's head: its fetched review's once there is one, else the
 * listing's (a draft says draft; the author linked where the forge has
 * profile pages, by `remote`).
 */
export function prHead(pr: RelevantPr, review: PrReview | null, remote: string | null): PrHead {
  if (review) return review;
  return {
    provider: pr.provider,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: shownPrState(pr),
    author: pr.author,
    authorUrl: githubProfileUrl(remote, pr.author),
    commits: null,
    baseRef: pr.baseRefName,
    headRef: pr.headRefName,
  };
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

/** The PR's assignees but you: the "You" row already says you're assigned. */
export function otherAssignees(
  review: Pick<PrReview, 'assignees' | 'viewerIsAssignee' | 'viewerName'>,
): string[] {
  const me = review.viewerIsAssignee ? review.viewerName : null;
  return me ? review.assignees.filter((a) => a !== me) : review.assignees;
}
