import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { StatusLineData, UsageThresholds } from '../../shared/types';

export function useThresholdAlerts(
  statusLineData: Record<string, StatusLineData>,
  usageThresholds: UsageThresholds,
  taskNames: Record<string, string>,
) {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Prune fired keys for PTYs that no longer exist
    for (const key of firedRef.current) {
      const ptyId = key.split(':')[0];
      if (!statusLineData[ptyId]) {
        firedRef.current.delete(key);
      }
    }

    for (const [ptyId, sl] of Object.entries(statusLineData)) {
      const checks: [string, number, number | null][] = [
        ['context', sl.contextUsage.percentage, usageThresholds.contextPercentage],
        [
          'fiveHour',
          sl.rateLimits?.fiveHour?.usedPercentage ?? 0,
          usageThresholds.fiveHourPercentage,
        ],
        [
          'sevenDay',
          sl.rateLimits?.sevenDay?.usedPercentage ?? 0,
          usageThresholds.sevenDayPercentage,
        ],
      ];
      const taskName = taskNames[ptyId];
      for (const [kind, value, threshold] of checks) {
        if (threshold === null || threshold <= 0) continue;
        const key = `${ptyId}:${kind}`;

        // Hysteresis: clear fired state when value drops below 90% of threshold
        if (value < threshold * 0.9) {
          firedRef.current.delete(key);
          continue;
        }

        if (value >= threshold && !firedRef.current.has(key)) {
          firedRef.current.add(key);
          const pct = Math.round(value);
          const labels: Record<string, string> = {
            context: `Context window at ${pct}%`,
            fiveHour: `5-hour rate limit at ${pct}%`,
            sevenDay: `7-day rate limit at ${pct}%`,
          };
          const base = labels[kind] || `Usage threshold reached: ${kind}`;
          toast.warning(taskName ? `${taskName}: ${base}` : base);
        }
      }
    }
  }, [statusLineData, usageThresholds, taskNames]);
}
