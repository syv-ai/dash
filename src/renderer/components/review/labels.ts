import type {
  PrCheck,
  PrFile,
  PrProvider,
  PrReviewThread,
  PrReviewer,
  PrState,
} from '../../../shared/types';
import { formatDateTime, type ClockOptions } from '../../utils/format';

/** The forge's name, as people say it. */
export const providerName = (p: PrProvider): string => (p === 'ado' ? 'Azure DevOps' : 'GitHub');

/** What a comment's author is to the PR, for the badge beside their name:
 *  "Author" for whoever opened it (first, should they also be listed as a
 *  reviewer), "Reviewer" for anyone assigned or requested to review, else
 *  nothing. Forge logins compare case-insensitively. */
export function commentRole(
  author: string,
  pr: { author: string; reviewers: readonly Pick<PrReviewer, 'name'>[] },
): 'Author' | 'Reviewer' | null {
  const who = author.toLowerCase();
  if (pr.author.toLowerCase() === who) return 'Author';
  return pr.reviewers.some((r) => r.name.toLowerCase() === who) ? 'Reviewer' : null;
}

/** What a role badge's tooltip says: "Author of this pull request", or
 *  "Requested reviewer · approved" with where the reviewer stands. */
export function commentRoleTip(
  role: 'Author' | 'Reviewer',
  author: string,
  pr: { reviewers: readonly Pick<PrReviewer, 'name' | 'state'>[] },
): string {
  if (role === 'Author') return 'Author of this pull request';
  const who = author.toLowerCase();
  const reviewer = pr.reviewers.find((r) => r.name.toLowerCase() === who);
  return reviewer
    ? `Requested reviewer · ${REVIEWER_STATE_WORDS[reviewer.state].toLowerCase()}`
    : 'Requested reviewer';
}

/** Where a reviewer stands, in words: a roster mark's tooltip and label. */
export const REVIEWER_STATE_WORDS: Record<PrReviewer['state'], string> = {
  approved: 'Approved',
  approved_with_suggestions: 'Approved with suggestions',
  changes_requested: 'Asked for changes',
  rejected: 'Rejected',
  waiting: 'Waiting for the author',
  commented: 'Commented',
  pending: 'Not reviewed yet',
};

/** The order a roster reads in: the verdicts, then comments, then requests. */
const REVIEWER_ORDER = Object.keys(REVIEWER_STATE_WORDS) as PrReviewer['state'][];

/** The PR's reviewers as one roster: by where they stand (verdicts, then
 *  comments, then those still asked), keeping the forge's order within each;
 *  those who declined (ADO) last, whatever their vote. */
export function reviewerRoster(reviewers: readonly PrReviewer[]): PrReviewer[] {
  const asked = reviewers.filter((r) => !r.declined);
  return [
    ...REVIEWER_ORDER.flatMap((state) => asked.filter((r) => r.state === state)),
    ...reviewers.filter((r) => r.declined),
  ];
}

export const CHECK_LABELS: Record<PrCheck['state'], string> = {
  passing: 'Passing',
  failing: 'Failing',
  pending: 'Running',
  skipped: 'Skipped',
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the PR's diff adds up to: its files and their lines added and deleted. */
export function diffTotals(files: readonly Pick<PrFile, 'additions' | 'deletions'>[]): {
  files: number;
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { files: files.length, additions, deletions };
}

/** "(1 of 4 resolved)", what follows About's "4 threads"; null with none. */
export function threadsResolved(
  threads: readonly Pick<PrReviewThread, 'resolved'>[],
): string | null {
  if (threads.length === 0) return null;
  const resolved = threads.filter((t) => t.resolved).length;
  return `(${resolved} of ${threads.length} resolved)`;
}

/** A PR's date (ISO 8601) in full, in the user's locale: "Thu 26/11/2026, 09:00";
 *  '' when it doesn't parse. */
export function prDateTime(iso: string, clock?: ClockOptions): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : formatDateTime(new Date(ms), clock);
}

/** What the author does with the PR's commits, by its state: "wants to merge"
 *  (open, draft), "merged", or "wanted to merge" (closed). */
export const mergeVerb = (state: PrState, you = false): string =>
  state === 'merged'
    ? 'merged'
    : state === 'closed'
      ? 'wanted to merge'
      : you
        ? 'want to merge'
        : 'wants to merge';
