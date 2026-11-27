import { useEffect, useRef } from 'react';
import { toast } from '../components/ui/toast';
import type { UsageThresholds } from '../../shared/types';
import { useRuntime, type RuntimeState } from '../stores/runtimeStore';

/** Toast once when a session's context or the account's limits cross their
 *  threshold. Subscribes to the store outside render, so a status-line push
 *  re-renders nothing. */
export function useThresholdAlerts(
  usageThresholds: UsageThresholds,
  taskNames: Record<string, string>,
) {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const check = ({ contextUsage, rateLimits }: RuntimeState) => {
      // Prune fired context keys for PTYs that no longer exist. Global
      // rate-limit keys ('global:*') are kept across PTY churn.
      for (const key of firedRef.current) {
        if (key.startsWith('global:')) continue;
        const ptyId = key.split(':')[0]!;
        if (!contextUsage[ptyId]) {
          firedRef.current.delete(key);
        }
      }

      const fire = (key: string, value: number, threshold: number | null, label: string) => {
        if (threshold === null || threshold <= 0) return;
        if (value < threshold * 0.9) {
          firedRef.current.delete(key);
          return;
        }
        if (value >= threshold && !firedRef.current.has(key)) {
          firedRef.current.add(key);
          toast.warning(label, { key: `threshold:${key}` });
        }
      };

      // Context window is per-session, so check each PTY independently.
      for (const [ptyId, usage] of Object.entries(contextUsage)) {
        // No task name means the toast can't say which task it is about; skip
        // it. The key stays unfired, so it fires once the name is known.
        const taskName = taskNames[ptyId];
        if (!taskName) continue;
        const pct = Math.round(usage.percentage);
        fire(
          `${ptyId}:context`,
          usage.percentage,
          usageThresholds.contextPercentage,
          `${taskName}: Context window at ${pct}%`,
        );
      }

      // Rate limits are account-wide: the merged reading (`mergeRateLimits`),
      // not any one session's snapshot, which can be stale.
      const fh = rateLimits?.fiveHour?.usedPercentage ?? 0;
      fire(
        'global:fiveHour',
        fh,
        usageThresholds.fiveHourPercentage,
        `5-hour rate limit at ${Math.round(fh)}%`,
      );
      const sd = rateLimits?.sevenDay?.usedPercentage ?? 0;
      fire(
        'global:sevenDay',
        sd,
        usageThresholds.sevenDayPercentage,
        `7-day rate limit at ${Math.round(sd)}%`,
      );
    };

    check(useRuntime.getState());
    return useRuntime.subscribe((s, prev) => {
      if (s.contextUsage !== prev.contextUsage || s.rateLimits !== prev.rateLimits) check(s);
    });
  }, [usageThresholds, taskNames]);
}
