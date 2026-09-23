/**
 * Neutral progress bar for work that is simply underway — a download, an
 * install. Distinct from `UsageBar`, which colours by threshold (amber, then
 * red) because there "more" means "worse"; here it does not. Without `percent`
 * it is indeterminate: a full, pulsing bar for work of unknown length.
 */
export function ProgressBar({
  percent,
  height = 4,
  className = '',
  label,
}: {
  /** 0–100; values outside are clamped. Omit for indeterminate progress. */
  percent?: number;
  height?: number;
  className?: string;
  /** Accessible description of what is progressing. */
  label?: string;
}) {
  const indeterminate = percent === undefined;
  const pct = indeterminate ? 100 : Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`rounded-full bg-border/40 overflow-hidden ${className}`}
      style={{ height: `${height}px` }}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full bg-primary transition-all duration-300 ${
          indeterminate ? 'animate-pulse opacity-60' : ''
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
