import {
  CircleCheck,
  CircleEllipsis,
  CircleMinus,
  CircleX,
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from 'lucide-react';
import type { CiState, PrCheck, PrState } from '../../../shared/types';

/*
 * A PR's state as GitHub shows it, for every PR surface (header badge, picker,
 * lists, review mode's banner and title): open green (state-done), draft grey
 * (ink-2), merged purple (pr-merged), closed red (state-fail), each with
 * GitHub's icon. Returned as Tailwind class fragments.
 */

/** The state's icon: GitHub's open-PR icon has the arrowhead (ca7987b). */
export function prStateIcon(state: PrState): LucideIcon {
  switch (state) {
    case 'merged':
      return GitMerge;
    case 'closed':
      return GitPullRequestClosed;
    case 'draft':
      return GitPullRequestDraft;
    case 'open':
    default:
      return GitPullRequestArrow;
  }
}

/** Just the text/icon colour for a PR state (no background). */
export function prStatusText(state: PrState): string {
  switch (state) {
    case 'merged':
      return 'text-pr-merged';
    case 'closed':
      return 'text-state-fail';
    case 'draft':
      return 'text-ink-2';
    case 'open':
    default:
      return 'text-state-done';
  }
}

/** A tint of the state's colour with its text over it: a band or pill that
 *  says the state (readable in either theme). */
export function prStatusTint(state: PrState): string {
  switch (state) {
    case 'merged':
      return 'bg-pr-merged/12 text-pr-merged';
    case 'closed':
      return 'bg-state-fail/12 text-state-fail';
    case 'draft':
      return 'bg-ink-3/15 text-ink-2';
    case 'open':
    default:
      return 'bg-state-done/12 text-state-done';
  }
}

/** The tint as a clickable pill: a stronger tint on hover. */
export function prStatusPill(state: PrState): string {
  const hover =
    state === 'merged'
      ? 'hover:bg-pr-merged/20'
      : state === 'closed'
        ? 'hover:bg-state-fail/20'
        : state === 'draft'
          ? 'hover:bg-ink-3/25'
          : 'hover:bg-state-done/20';
  return `${prStatusTint(state)} ${hover}`;
}

/** The pulse (index.css) for a PR icon while its checks run, else nothing. */
export function ciPulse(ci: CiState): string {
  return ci === 'pending' ? 'pr-ci-running' : '';
}

/** Checks' colour by their rolled-up state, as an open PR's icon shows them:
 *  red failing, amber running, green passing. */
export function ciText(ci: CiState): string {
  return ci === 'failing'
    ? 'text-state-fail'
    : ci === 'pending'
      ? 'text-state-needs'
      : 'text-state-done';
}

export function ciLabel(ci: CiState): string {
  return ci === 'failing'
    ? 'checks failing'
    : ci === 'pending'
      ? 'checks running'
      : 'checks passing';
}

/** How one check state (or a PR's rolled-up checks) looks: a circle icon whose
 *  glyph says the state, coloured as `ciText` colours the rollup (skipped stays
 *  the neutral `icon`), pulsing while it runs. One mapping for the rollup and
 *  every check row; `CheckStateIcon` draws it solid. */
export function checkLook(state: PrCheck['state']): {
  icon: LucideIcon;
  tone: string;
  pulse: string;
} {
  if (state === 'skipped') return { icon: CircleMinus, tone: 'text-icon', pulse: '' };
  const icon = state === 'failing' ? CircleX : state === 'pending' ? CircleEllipsis : CircleCheck;
  return { icon, tone: ciText(state), pulse: ciPulse(state) };
}
