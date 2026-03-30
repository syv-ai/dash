import { useState, useEffect, useMemo } from 'react';
import type { ContextUsage, StatusLineData, RateLimits } from '../../shared/types';

const STALE_MS = 60_000;
const PRUNE_INTERVAL_MS = 30_000;

export function useStatusLine() {
  const [statusLineData, setStatusLineData] = useState<Record<string, StatusLineData>>({});

  // Subscribe to status line updates from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.onPtyStatusLine((data) => {
      setStatusLineData(data as Record<string, StatusLineData>);
    });

    window.electronAPI.ptyGetAllStatusLine().then((resp) => {
      if (resp.success && resp.data) {
        setStatusLineData(resp.data);
      }
    });

    return unsubscribe;
  }, []);

  // Prune stale entries every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      setStatusLineData((prev) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, StatusLineData> = {};
        for (const [id, sl] of Object.entries(prev)) {
          if (now - new Date(sl.updatedAt).getTime() > STALE_MS) {
            changed = true;
          } else {
            next[id] = sl;
          }
        }
        return changed ? next : prev;
      });
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(timer);
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
      if (sl.rateLimits && new Date(sl.updatedAt).getTime() > bestTime) {
        best = sl.rateLimits;
        bestTime = new Date(sl.updatedAt).getTime();
      }
    }
    return best;
  }, [statusLineData]);

  return { statusLineData, contextUsage, latestRateLimits };
}
