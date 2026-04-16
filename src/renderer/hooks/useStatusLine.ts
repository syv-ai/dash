import { useState, useEffect, useMemo } from 'react';
import type { ContextUsage, StatusLineData, RateLimits } from '../../shared/types';

export function useStatusLine() {
  const [statusLineData, setStatusLineData] = useState<Record<string, StatusLineData>>({});

  // Subscribe to status line updates from main process.
  // Stale entry cleanup is handled by ContextUsageService.unregister() on PTY exit.
  // The Map is in-memory, so stale entries from crashes are cleared on app restart.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onPtyStatusLine((data) => {
      setStatusLineData(data as Record<string, StatusLineData>);
    });

    window.electronAPI
      .ptyGetAllStatusLine()
      .then((resp) => {
        if (resp.success && resp.data) {
          setStatusLineData(resp.data);
        }
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

  // Extract account-wide rate limits from the most recently updated session
  const latestRateLimits = useMemo((): RateLimits | undefined => {
    let best: RateLimits | undefined;
    let bestTime = 0;
    for (const sl of Object.values(statusLineData)) {
      if (sl.rateLimits && sl.updatedAt > bestTime) {
        best = sl.rateLimits;
        bestTime = sl.updatedAt;
      }
    }
    return best;
  }, [statusLineData]);

  return { statusLineData, contextUsage, latestRateLimits };
}
