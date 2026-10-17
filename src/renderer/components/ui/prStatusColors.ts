import type { CiState, PullRequestState } from '../../../shared/types';

/**
 * PR status colors: open → green (git-added), merged → purple (pr-merged),
 * closed → muted grey. Red is kept for an open PR whose checks fail (PrBadge),
 * so a closed PR (finished, nothing to do) doesn't read as an alarm. Returned
 * as Tailwind class fragments so every PR surface — header badge, picker
 * trigger, list icons — stays consistent.
 */
export function prStatusPill(state: PullRequestState): string {
  switch (state) {
    case 'merged':
      return 'bg-[hsl(var(--pr-merged))]/10 text-[hsl(var(--pr-merged))] hover:bg-[hsl(var(--pr-merged))]/20';
    case 'closed':
      return 'bg-foreground/5 text-muted-fade-70 hover:bg-foreground/10';
    case 'open':
    default:
      return 'bg-[hsl(var(--git-added))]/10 text-[hsl(var(--git-added))] hover:bg-[hsl(var(--git-added))]/20';
  }
}

/** Just the text/icon color for a PR state (no background). */
export function prStatusText(state: PullRequestState): string {
  switch (state) {
    case 'merged':
      return 'text-[hsl(var(--pr-merged))]';
    case 'closed':
      return 'text-muted-fade-70';
    case 'open':
    default:
      return 'text-[hsl(var(--git-added))]';
  }
}

/** The outline for a PR's combined checks (index.css): a looping glow while
 *  they run, else nothing (PrBadge turns a failing PR's icon red). */
export function ciOutline(ci: CiState): string {
  return ci === 'pending' ? 'pr-ci-running' : '';
}

export function ciLabel(ci: CiState): string {
  return ci === 'failing'
    ? 'checks failing'
    : ci === 'pending'
      ? 'checks running'
      : 'checks passing';
}
