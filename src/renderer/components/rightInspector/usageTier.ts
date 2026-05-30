export type UsageTier = 'good' | 'warn' | 'danger';

/** Map a usage percentage (0..100+) to a tier for the usage strip bar color. */
export function usageTier(pct: number): UsageTier {
  if (pct >= 85) return 'danger';
  if (pct >= 60) return 'warn';
  return 'good';
}
