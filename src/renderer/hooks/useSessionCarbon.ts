import { useEffect, useState } from 'react';
import type { SessionUpdate } from '../../shared/sessionTypes';

/**
 * Tracks the latest estimated energy (Wh) per task, derived from the same
 * `session:update` stream the structured view consumes. Returns the energy for
 * the active task's current session, or undefined if none seen yet.
 */
export function useSessionCarbon(taskId: string | null | undefined): number | undefined {
  const [energyByTask, setEnergyByTask] = useState<Record<string, number>>({});

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionUpdate((update: SessionUpdate) => {
      setEnergyByTask((prev) => {
        const next = update.metrics.energyWh;
        if (prev[update.taskId] === next) return prev;
        return { ...prev, [update.taskId]: next };
      });
    });
    return unsubscribe;
  }, []);

  return taskId ? energyByTask[taskId] : undefined;
}
