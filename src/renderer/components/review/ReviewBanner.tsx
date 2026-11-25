import type { PrRef, PrState } from '../../../shared/types';
import { Banner } from '../ui/Banner';
import { prStateIcon } from '../ui/prStatusColors';

/**
 * Review mode's band across the task sidebar, above its views: "Reviewing PR
 * #n" in the PR's state colour, GitHub's (open green, draft grey, merged
 * purple, closed red; neutral until the PR loads), its ✕ exiting the mode.
 * PR state is the one colour outside agent state the sidebar shows (D133).
 */
export function ReviewBanner({
  mode,
  state,
  onExit,
}: {
  mode: PrRef;
  /** The PR's state once loaded; null while it loads. */
  state: PrState | null;
  onExit: () => void;
}) {
  const Icon = prStateIcon(state ?? 'open');
  return (
    <Banner
      icon={<Icon size={14} strokeWidth={1.8} />}
      dismissLabel="Exit review"
      onDismiss={onExit}
      tone={state}
    >
      Reviewing PR <span className="tabular-nums">#{mode.number}</span>
    </Banner>
  );
}
