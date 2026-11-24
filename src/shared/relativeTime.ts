/**
 * Compact "time ago" label — e.g. `45s`, `12m`, `3h`, `5d`, `8mo`, `2y`.
 *
 * `now` is taken as an argument (unix seconds) so callers can pass
 * `Date.now() / 1000` while tests stay deterministic. Returns '' for a falsy
 * timestamp; future times clamp to `0s`.
 */
export function formatRelativeTime(unixSeconds: number, now: number): string {
  if (!unixSeconds) return '';
  const s = Math.max(0, Math.floor(now - unixSeconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

/**
 * A spoken "time ago" for a single moment — `just now`, `4 min ago`,
 * `2 hr ago`, `3 days ago`, `5 mo ago`, `2 yr ago`. Same buckets and
 * arguments (unix seconds) as `formatRelativeTime`; '' for a falsy timestamp.
 */
export function formatTimeAgo(unixSeconds: number, now: number): string {
  if (!unixSeconds) return '';
  const s = Math.max(0, Math.floor(now - unixSeconds));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 30) {
    const d = Math.floor(s / 86400);
    return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  }
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))} mo ago`;
  return `${Math.floor(s / (86400 * 365))} yr ago`;
}
