import type { PullRequestState } from '../../../shared/types';

/**
 * Standard PR status colors (GitHub convention): open → green (git-added),
 * merged → purple (pr-merged), closed → red (destructive). Returned as Tailwind
 * class fragments so every PR surface — header badge, picker trigger, list
 * icons — stays consistent.
 */
export function prStatusPill(state: PullRequestState): string {
  switch (state) {
    case 'merged':
      return 'bg-[hsl(var(--pr-merged))]/10 text-[hsl(var(--pr-merged))] hover:bg-[hsl(var(--pr-merged))]/20';
    case 'closed':
      return 'bg-destructive/10 text-destructive hover:bg-destructive/20';
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
      return 'text-destructive';
    case 'open':
    default:
      return 'text-[hsl(var(--git-added))]';
  }
}
