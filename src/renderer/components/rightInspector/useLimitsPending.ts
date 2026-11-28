import * as React from 'react';
import type { RateLimits } from '../../../shared/types';
import { useStartupWindow } from '../../hooks/useStartupWindow';

/**
 * How long the limits may take to arrive before the usage row stops waiting
 * for them. They come only with a session's status line, after its first API
 * reply, and never for an account without a subscription. [provisional]
 */
export const LIMITS_WAIT_MS = 8_000;

/** Whether the limits came last time ('1'), or a status line came without
 *  them ('0'). */
const KEY = 'dash:limits-expected';

function readExpected(): boolean {
  try {
    // A first run has no answer yet: wait, as for a subscriber.
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

function writeExpected(expected: boolean): void {
  try {
    localStorage.setItem(KEY, expected ? '1' : '0');
  } catch {
    // Storage unavailable: the next start waits, as on a first run.
  }
}

/**
 * Whether the account's limits are on their way: shortly after the window
 * loads, before the first reading, on an account that had limits last time.
 * The usage row holds their columns as skeletons meanwhile, so the rings
 * land without moving it. An account without limits is learnt once, when the
 * wait ends after a status line came without them, so it doesn't see
 * skeletons come and go on every start; a wait with no status line at all
 * (no session spoke yet) proves nothing and leaves the answer as it was.
 */
export function useLimitsPending(
  rateLimits: RateLimits | undefined,
  /** Whether the task's session has sent a status line (its context). */
  statusArrived: boolean,
): boolean {
  const starting = useStartupWindow(LIMITS_WAIT_MS);
  const [expected] = React.useState(readExpected);
  const arrived = rateLimits !== undefined;
  React.useEffect(() => {
    if (arrived) writeExpected(true);
    else if (!starting && statusArrived) writeExpected(false);
  }, [arrived, starting, statusArrived]);
  return expected && starting && !arrived;
}
