import type { CiState, PullRequestState } from '../../../shared/types';

/**
 * Standard PR status colors (GitHub convention): open → green (state-done),
 * merged → purple (pr-merged), closed → red (state-fail). Returned as Tailwind
 * class fragments so every PR surface — header badge, picker trigger, list
 * icons — stays consistent.
 */
export function prStatusPill(state: PullRequestState): string {
  switch (state) {
    case 'merged':
      return 'bg-[hsl(var(--pr-merged))]/10 text-[hsl(var(--pr-merged))] hover:bg-[hsl(var(--pr-merged))]/20';
    case 'closed':
      return 'bg-state-fail/10 text-state-fail hover:bg-state-fail/20';
    case 'open':
    default:
      return 'bg-state-done/10 text-state-done hover:bg-state-done/20';
  }
}

/** Just the text/icon color for a PR state (no background). */
export function prStatusText(state: PullRequestState): string {
  switch (state) {
    case 'merged':
      return 'text-[hsl(var(--pr-merged))]';
    case 'closed':
      return 'text-state-fail';
    case 'open':
    default:
      return 'text-state-done';
  }
}

/** The pulse (index.css) for a PR icon while its checks run, else nothing. */
export function ciPulse(ci: CiState): string {
  return ci === 'pending' ? 'pr-ci-running' : '';
}

export function ciLabel(ci: CiState): string {
  return ci === 'failing'
    ? 'checks failing'
    : ci === 'pending'
      ? 'checks running'
      : 'checks passing';
}
