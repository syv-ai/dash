import { useState, useEffect, useMemo } from 'react';
import type { ContextUsage, StatusLineData } from '../../shared/types';
import { limitPaces, recordLimits, type LimitHistories } from '../lib/pace';
import { mergeRateLimits } from '../lib/rateLimits';

export function useStatusLine() {
  const [statusLineData, setStatusLineData] = useState<Record<string, StatusLineData>>({});
  // Recent readings of the limits, in memory, for their pace.
  const [limitHistories, setLimitHistories] = useState<LimitHistories>({});

  // Subscribe to status line updates from main process.
  // Stale entry cleanup is handled by ContextUsageService.unregister() on PTY exit.
  // The Map is in-memory, so stale entries from crashes are cleared on app restart.
  useEffect(() => {
    const receive = (data: Record<string, StatusLineData>) => {
      setStatusLineData(data);
      const limits = mergeRateLimits(data, Date.now());
      if (limits) setLimitHistories((h) => recordLimits(h, limits, Date.now()));
    };
    const unsubscribe = window.electronAPI.onPtyStatusLine((data) => {
      receive(data as Record<string, StatusLineData>);
    });

    window.electronAPI
      .ptyGetAllStatusLine()
      .then((resp) => {
        if (resp.success && resp.data) receive(resp.data);
      })
      .catch((err) => {
        console.warn('[useStatusLine] Initial fetch failed:', err);
      });

    return unsubscribe;
  }, []);

  // Derive contextUsage from statusLineData (replaces separate IPC channel)
  const contextUsage = useMemo((): Record<string, ContextUsage> => {
    const result: Record<string, ContextUsage> = {};
    for (const [id, sl] of Object.entries(statusLineData)) {
      result[id] = sl.contextUsage;
    }
    return result;
  }, [statusLineData]);

  const latestRateLimits = useMemo(
    () => mergeRateLimits(statusLineData, Date.now()),
    [statusLineData],
  );
  const paces = useMemo(
    () => limitPaces(limitHistories, latestRateLimits ?? {}),
    [limitHistories, latestRateLimits],
  );

  return { statusLineData, contextUsage, latestRateLimits, paces };
}
