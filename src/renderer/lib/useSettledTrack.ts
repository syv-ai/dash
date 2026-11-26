import { useEffect, useRef } from 'react';
import { track } from './telemetry';

/**
 * Report `value` (as `property`) once it has held for `settleMs` and differs
 * from what was last reported: a layout that passes through a state on its
 * way elsewhere (mid-ease) isn't counted. The first value is the baseline,
 * not a change.
 */
export function useSettledTrack(
  event: string,
  property: string,
  value: string,
  settleMs = 1_000,
): void {
  const reported = useRef(value);
  useEffect(() => {
    if (value === reported.current) return;
    const timer = setTimeout(() => {
      reported.current = value;
      track(event, { [property]: value });
    }, settleMs);
    return () => clearTimeout(timer);
  }, [event, property, value, settleMs]);
}
