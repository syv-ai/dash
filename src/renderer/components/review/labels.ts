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

/** Who stands where on the PR, said as GitHub's sidebar does: "Approved by",
 *  "Changes requested by", "Review requested from"; ADO's votes add theirs. */
const REVIEWER_LEADS: Record<PrReviewer['state'], string> = {
  approved: 'Approved by',
  approved_with_suggestions: 'Approved with suggestions by',
  changes_requested: 'Changes requested by',
  rejected: 'Rejected by',
  waiting: 'Waiting for the author:',
  commented: 'Commented by',
  pending: 'Review requested from',
};

/** The order the groups read in: the verdicts, then comments, then requests. */
const REVIEWER_ORDER = Object.keys(REVIEWER_LEADS) as PrReviewer['state'][];

/** The PR's reviewers grouped by where they stand, each group led by its
 *  words ("Approved by") and keeping the forge's order of people; groups
 *  without anyone are left out. */
export function reviewerGroups(
  reviewers: readonly PrReviewer[],
): { lead: string; reviewers: PrReviewer[] }[] {
  return REVIEWER_ORDER.map((state) => ({
    lead: REVIEWER_LEADS[state],
    reviewers: reviewers.filter((r) => r.state === state),
  })).filter((g) => g.reviewers.length > 0);
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

/** "4 comment threads (1 of 4 resolved)"; null with none. */
export function threadsLine(threads: readonly Pick<PrReviewThread, 'resolved'>[]): string | null {
  if (threads.length === 0) return null;
  const resolved = threads.filter((t) => t.resolved).length;
  return `${plural(threads.length, 'comment thread')} (${resolved} of ${threads.length} resolved)`;
}

/** A PR's date (ISO 8601) in full, in the user's locale: "Thu 26/11/2026, 09:00";
 *  '' when it doesn't parse. */
export function prDateTime(iso: string, clock?: ClockOptions): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : formatDateTime(new Date(ms), clock);
}

/** What the author does with the PR's commits, by its state: "wants to merge"
 *  (open, draft), "merged", or "wanted to merge" (closed). */
export const mergeVerb = (state: PrState): string =>
  state === 'merged' ? 'merged' : state === 'closed' ? 'wanted to merge' : 'wants to merge';
