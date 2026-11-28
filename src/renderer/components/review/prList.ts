import { reviewVerdict, type ReviewVerdict } from '../../../shared/prVerdict';
import type {
  PrDetails,
  PrGitField,
  PrReview,
  PrViewerInvolvement,
  RelevantPr,
  RelevantPrs,
} from '../../../shared/types';
import { forkPrOfBranch } from '../../../shared/prBranch';
import { githubProfileUrl } from '../../../shared/urls';
import { shownPrState } from '../ui/prStatusColors';
import { diffTotals } from './labels';

/**
 * The PRs view's PRs, in order: the branch's own PRs first (opened from it),
 * then those into it, each newest first as the forge listed them. Empty
 * until listed.
 */
export function taskPrList(relevant: RelevantPrs | null): RelevantPr[] {
  return relevant ? [...relevant.from, ...relevant.into] : [];
}

/**
 * What a PR card (`PrCard`) draws: the PR as its forge tells it, with the
 * parts only git can tell (its files, commits, merge-base and distance behind
 * base) where it was read through a checkout. The task's PRs view loads the
 * full review (`PrReview` is one); the project page reads its forge alone
 * (`PrDetails`), as it must never fetch into the project's checkout.
 */
export type PrCardReview = PrDetails & Partial<Pick<PrReview, PrGitField>>;

/** What a PR's head (`ReviewHeader`) says of it; the commit count only where
 *  git counted it. `headFromFork`: its head branch is a fork's, which origin's
 *  same-named branch (if any) isn't, so the header doesn't link it there;
 *  `forkHeadUrl` is that branch on the fork's own page, where the forge said. */
export type PrHead = Pick<
  PrReview,
  'provider' | 'number' | 'title' | 'url' | 'state' | 'author' | 'authorUrl' | 'baseRef' | 'headRef'
> & { commits: number | null; headFromFork: boolean; forkHeadUrl: string | null };

/**
 * Whether PR `number`'s head is a fork's, as far as the renderer can tell
 * (the review itself doesn't say): the task's listing of its PRs says so, or
 * the task is on the fork PR's own branch (`pr/<number>/<head>`).
 */
export function headFromFork(
  number: number,
  relevant: RelevantPrs | null,
  taskBranch: string | null,
): boolean {
  const listed = taskPrList(relevant).find((p) => p.number === number);
  if (listed) return listed.fromFork;
  return !!taskBranch && forkPrOfBranch(taskBranch)?.number === number;
}

/** PR `number`'s head branch on its fork's page, from the task's listing. */
export const forkHeadUrl = (number: number, relevant: RelevantPrs | null): string | null =>
  taskPrList(relevant).find((p) => p.number === number)?.headUrl ?? null;

/**
 * A listed PR's head: its fetched review's once there is one (with no commit
 * count where it was read without git), else the listing's (a draft says
 * draft; the author linked where the forge has profile pages, by `remote`).
 */
export function prHead(pr: RelevantPr, review: PrCardReview | null, remote: string | null): PrHead {
  if (review)
    return {
      provider: review.provider,
      number: review.number,
      title: review.title,
      url: review.url,
      state: review.state,
      author: review.author,
      authorUrl: review.authorUrl,
      commits: review.commits ?? null,
      baseRef: review.baseRef,
      headRef: review.headRef,
      headFromFork: pr.fromFork,
      forkHeadUrl: pr.headUrl,
    };
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
    headFromFork: pr.fromFork,
    forkHeadUrl: pr.headUrl,
  };
}

/** The PRs tab is there only while the branch has PRs from or into it. */
export const prsTabShown = (relevant: RelevantPrs | null): boolean =>
  taskPrList(relevant).length > 0;

/** How the person stands on a PR, as far as it asks something of them. */
export type YourPartInput = Pick<
  PrReview,
  'viewerIsAuthor' | 'viewerIsAssignee' | 'viewerIsRequestedReviewer' | 'viewerReview'
>;

/** A review of theirs, named as the thing commits can land after. */
const OWN_REVIEW_NOUNS: Record<NonNullable<PrReview['viewerReview']>['state'], string> = {
  approved: 'approval',
  approved_with_suggestions: 'approval',
  changes_requested: 'request for changes',
  commented: 'review',
  waiting: 'vote',
  rejected: 'rejection',
};

/**
 * The one line a PR card says about the person, only where it asks something
 * of them: they're asked to review it, commits landed after their review, or
 * it's assigned to them (and isn't theirs). Null otherwise: being its author
 * reads in the merge line ("You want to merge"), a current review in the
 * card's verdict, and a comment asks nothing.
 */
export function yourPart(v: YourPartInput): string | null {
  if (v.viewerIsRequestedReviewer) return "You're asked to review it";
  if (v.viewerReview?.stale)
    return `New commits since your ${OWN_REVIEW_NOUNS[v.viewerReview.state]}`;
  if (v.viewerIsAssignee && !v.viewerIsAuthor) return "It's assigned to you";
  return null;
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

export { reviewVerdict, type ReviewVerdict };

/** `yourPart` from the listing, before the PR's review is fetched (which
 *  adds the person's own review). Null where the forge couldn't say who they are. */
export function listedYourPart(viewer: PrViewerInvolvement | null): string | null {
  if (!viewer) return null;
  return yourPart({
    viewerIsAuthor: viewer.isAuthor,
    viewerIsAssignee: viewer.isAssignee,
    viewerIsRequestedReviewer: viewer.isRequestedReviewer,
    viewerReview: null,
  });
}

/** The task PRs view's drawers open at first: the only PR, or the branch's
 *  own (listed first); the rest folded. */
export const prOpenByDefault = (relevant: RelevantPrs | null, index: number): boolean =>
  index === 0 && (taskPrList(relevant).length === 1 || (relevant?.from.length ?? 0) > 0);

/** What a PR card's head says of it, from the listing until its review is
 *  fetched, then from the review (newer, and with the person's own review
 *  and comments). `files` only where git listed them. */
export interface PrCardFacts {
  additions: number | null;
  deletions: number | null;
  files: number | null;
  threads: { open: number; total: number } | null;
  verdict: ReviewVerdict | null;
  /** `yourPart`: the line the card says about the person, if any. */
  you: string | null;
  /** They opened it: the merge line says "You". */
  yours: boolean;
}

export function prCardFacts(pr: RelevantPr, review: PrCardReview | null): PrCardFacts {
  if (!review)
    return {
      additions: pr.additions,
      deletions: pr.deletions,
      files: null,
      threads: pr.threads,
      verdict: pr.verdict,
      you: listedYourPart(pr.viewer),
      yours: pr.viewer?.isAuthor ?? false,
    };
  const totals = review.files ? diffTotals(review.files) : null;
  return {
    additions: totals?.additions ?? pr.additions,
    deletions: totals?.deletions ?? pr.deletions,
    files: totals?.files ?? null,
    threads: {
      open: review.threads.filter((t) => !t.resolved).length,
      total: review.threads.length,
    },
    verdict: reviewVerdict(review.reviewers),
    you: yourPart(review),
    yours: review.viewerIsAuthor,
  };
}
