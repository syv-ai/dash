import { useEffect } from 'react';
import { useRuntime } from '../stores/runtimeStore';
import { sessionRegistry } from './SessionRegistry';
import { hibernateAfterMs, sweepEveryMs } from './hibernation';

/** Dev-only: a shorter threshold, in ms, to test hibernation quickly (K5). */
const devOverride = import.meta.env.DEV
  ? (import.meta.env.VITE_DASH_HIBERNATE_AFTER_MS as string | undefined)
  : undefined;

/**
 * Hibernates task terminals unseen for HIBERNATE_AFTER_MS (see hibernation.ts).
 * Mount once, at the app root.
 */
export function useTerminalHibernation(): void {
  useEffect(() => {
    const afterMs = hibernateAfterMs(devOverride);
    const timer = setInterval(() => {
      const rc = useRuntime.getState().remoteControlStates;
      sessionRegistry.hibernateIdle(Date.now(), afterMs, (id) => !!rc[id]);
    }, sweepEveryMs(afterMs));
    return () => clearInterval(timer);
  }, []);
}
