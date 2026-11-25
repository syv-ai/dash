import type { CheckoutVsHead } from '../../../shared/types';
import { plural } from './labels';

/** What the diff's right side is in review mode, and why it isn't the
 *  checkout when it isn't (spec Revision 3). */
export interface ReviewCheckout {
  /** The right side is the working-tree file: editable, with language
   *  servers. Otherwise it is the PR's head, read-only. */
  live: boolean;
  /** How the checkout differs from the PR ("2 local commits", "uncommitted
   *  changes"); empty when it doesn't. */
  differences: string[];
}

/**
 * The diff always shows the PR's pushed head. When the task's checkout is
 * at that head with a clean tree the right side is the live file (the same
 * text); otherwise the PR's head, read-only, and the differences say why.
 * Edits made while live keep it live (`wasLive`, until HEAD moves): the
 * person's buffer isn't swapped out under them, the notice just appears.
 * Differences are only told on the PR's head branch: off it (reviewing a PR
 * into this branch) the checkout is expected to differ, and saying so is
 * noise. `facts` null: not known yet, or the head isn't in the checkout.
 */
export function reviewCheckout({
  facts,
  branch,
  headRef,
  uncommitted,
  wasLive,
}: {
  facts: CheckoutVsHead | null;
  /** The branch checked out (null: detached). */
  branch: string | null;
  /** The PR's head branch. */
  headRef: string;
  /** The tree has changes, saved or not. */
  uncommitted: boolean;
  wasLive: boolean;
}): ReviewCheckout {
  const live = !!facts?.atHead && (!uncommitted || wasLive);
  const differences: string[] = [];
  if (branch !== headRef) return { live, differences };
  if (facts && !facts.atHead) {
    if (facts.ahead > 0) differences.push(plural(facts.ahead, 'local commit'));
    if (facts.behind > 0) differences.push(`${plural(facts.behind, 'commit')} behind`);
  }
  if (uncommitted) differences.push('uncommitted changes');
  return { live, differences };
}

/** "Your checkout differs from the PR: 2 local commits · uncommitted
 *  changes. Exit review to see them." Null when it doesn't. */
export function checkoutNotice(differences: readonly string[]): string | null {
  if (differences.length === 0) return null;
  return `Your checkout differs from the PR: ${differences.join(' · ')}. Exit review to see them.`;
}
