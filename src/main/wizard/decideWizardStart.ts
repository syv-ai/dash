/** Reason a wizard start request was declined. */
export type WizardStartReason = 'already-active' | 'dismissed' | 'not-relevant';

export type WizardStartDecision = { start: true } | { start: false; reason: WizardStartReason };

/**
 * How engaged this feature+task already is:
 *   - `live`       a side-car is genuinely running (pending or active) — a
 *                  second spawn would collide, so even a forced start is refused.
 *   - `suppressed` engaged earlier this session but finished (declined/completed/
 *                  migrated); no live side-car. Blocks the auto-offer path but a
 *                  forced start (user picked it from the dropdown) re-runs it.
 *   - `none`       never engaged this session.
 */
export type WizardEngagement = 'live' | 'suppressed' | 'none';

/**
 * Pure gate deciding whether a wizard:requestStart should spawn. `force` (a
 * user explicitly picking the wizard from the drawer dropdown) bypasses the
 * `dismissed`, `not-relevant`, and `suppressed` gates so a completed/dismissed/
 * declined wizard can be re-run — but a `live` side-car is always honored, since
 * re-spawning over one would collide on the tab id.
 */
export function decideWizardStart(opts: {
  dismissed: boolean;
  relevant: boolean;
  engagement: WizardEngagement;
  force?: boolean;
}): WizardStartDecision {
  if (opts.engagement === 'live') return { start: false, reason: 'already-active' };
  if (opts.force) return { start: true };
  if (opts.engagement === 'suppressed') return { start: false, reason: 'already-active' };
  if (opts.dismissed) return { start: false, reason: 'dismissed' };
  if (!opts.relevant) return { start: false, reason: 'not-relevant' };
  return { start: true };
}
