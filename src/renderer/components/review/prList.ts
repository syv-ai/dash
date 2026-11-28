import type {
  PrDetails,
  PrGitField,
  PrReview,
  PrViewerInvolvement,
  RelevantPr,
  RelevantPrs,
} from '../../../shared/types';
import { forkPrOfBranch } from '../../../shared/prBranch';
import { formatAgo } from '../../utils/format';
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
      commits: review.commits ?? pr.commits,
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
    commits: pr.commits,
    baseRef: pr.baseRefName,
    headRef: pr.headRefName,
    headFromFork: pr.fromFork,
    forkHeadUrl: pr.headUrl,
  };
}

/** The PRs tab is there only while the branch has PRs from or into it. */
export const prsTabShown = (relevant: RelevantPrs | null): boolean =>
  taskPrList(relevant).length > 0;

/** What the person's own review did, as "You …" says it. */
const YOUR_REVIEW_VERBS: Record<NonNullable<PrReview['viewerReview']>['state'], string> = {
  approved: 'approved it',
  approved_with_suggestions: 'approved it with suggestions',
  changes_requested: 'requested changes',
  rejected: 'rejected it',
  waiting: 'set it to waiting for the author',
  commented: 'commented',
};

/**
 * A PR card's line about the person, always one so the card keeps its size:
 * "You approved it 2 days ago" (their latest review), else "You opened it 3
 * hours ago" (theirs), "Your review is requested", or "You haven't reviewed
 * it". `now` in ms; a time the forge didn't give is left out.
 */
export function yourStanding(
  d: Pick<PrDetails, 'viewerReview' | 'viewerIsAuthor' | 'viewerIsRequestedReviewer' | 'createdAt'>,
  now: number,
): string {
  const ago = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? '' : ` ${formatAgo(Math.max(0, now - t))}`;
  };
  if (d.viewerReview)
    return `You ${YOUR_REVIEW_VERBS[d.viewerReview.state]}${ago(d.viewerReview.at)}`;
  if (d.viewerIsAuthor) return `You opened it${ago(d.createdAt)}`;
  if (d.viewerIsRequestedReviewer) return 'Your review is requested';
  return "You haven't reviewed it";
}
