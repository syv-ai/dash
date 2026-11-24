import type {
  PrCheck,
  PrFile,
  PrProvider,
  PrReviewThread,
  PrReviewer,
  PrState,
} from '../../../shared/types';
import { formatResetAt, type ClockOptions } from '../../utils/format';

/** The forge's name, as people say it. */
export const providerName = (p: PrProvider): string => (p === 'ado' ? 'Azure DevOps' : 'GitHub');

/** Words for a PR's state, its reviewers' states and its checks' states:
 *  the Review header's and the PR overview's. */
export const STATE_LABELS: Record<PrState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

export const REVIEWER_LABELS: Record<PrReviewer['state'], string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
  pending: 'pending',
  approved_with_suggestions: 'approved with suggestions',
  waiting: 'waiting for author',
  rejected: 'rejected',
};

export const CHECK_LABELS: Record<PrCheck['state'], string> = {
  passing: 'Passing',
  failing: 'Failing',
  pending: 'Running',
  skipped: 'Skipped',
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "12 changed files, +340 −27 total". */
export function changedFilesLine(
  files: readonly Pick<PrFile, 'additions' | 'deletions'>[],
): string {
  let add = 0;
  let del = 0;
  for (const f of files) {
    add += f.additions;
    del += f.deletions;
  }
  return `${files.length} changed file${files.length === 1 ? '' : 's'}, +${add} −${del} total`;
}

/** "4 comment threads (1 of 4 resolved)"; null with none. */
export function threadsLine(threads: readonly Pick<PrReviewThread, 'resolved'>[]): string | null {
  if (threads.length === 0) return null;
  const resolved = threads.filter((t) => t.resolved).length;
  return `${plural(threads.length, 'comment thread')} (${resolved} of ${threads.length} resolved)`;
}

/** A PR's date (ISO 8601) in full, in the user's locale: "Thu 26/11/2026, 09:00";
 *  '' when it doesn't parse. */
export const prDateTime = (iso: string, clock?: ClockOptions): string =>
  formatResetAt(Math.floor(Date.parse(iso) / 1000) || 0, clock);

/** The Communication bar's counts: "5 open · 2 drafts · 1 note", the empty
 *  ones left out; '' with nothing in it. */
export const communicationCounts = (n: { open: number; drafts: number; notes: number }): string =>
  [
    n.open > 0 && `${n.open} open`,
    n.drafts > 0 && plural(n.drafts, 'draft'),
    n.notes > 0 && plural(n.notes, 'note'),
  ]
    .filter(Boolean)
    .join(' · ');

/** What the author does with the PR's commits, by its state: "wants to merge"
 *  (open, draft), "merged", or "wanted to merge" (closed). */
export const mergeVerb = (state: PrState): string =>
  state === 'merged' ? 'merged' : state === 'closed' ? 'wanted to merge' : 'wants to merge';
