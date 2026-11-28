import { create } from 'zustand';
import type { HealthPoint, SystemHealthSnapshot } from '@shared/systemHealth';
import { appendPoint } from '../lib/healthHistory';
import { idleTaskIds } from '../lib/idleTasks';
import { useProjects } from './projectsStore';
import { useRuntime } from './runtimeStore';

interface SystemHealthState {
  /** Main's last sample while the health icon is on (`systemHealth:snapshot`),
   *  or null before the first one and while the icon is off. */
  snapshot: SystemHealthSnapshot | null;
  /** The popover's timeline: main's (`systemHealthHistory`, asked for as the
   *  popover opens), then each snapshot's point. Main keeps the record; this
   *  is its copy, so a reload loses nothing. */
  history: readonly HealthPoint[];
  setSnapshot: (snapshot: SystemHealthSnapshot | null) => void;
  setHistory: (history: readonly HealthPoint[]) => void;
}

export const useSystemHealthStore = create<SystemHealthState>((set) => ({
  snapshot: null,
  history: [],
  setSnapshot: (snapshot) =>
    set((s) =>
      snapshot
        ? {
            snapshot,
            history: appendPoint(s.history, {
              at: snapshot.sampledAt,
              totalBytes: snapshot.totalBytes,
            }),
          }
        : { snapshot: null, history: [] },
    ),
  // Main's record, plus any point a snapshot brought while the ask was on its way.
  setHistory: (history) =>
    set((s) => ({ history: s.history.reduce((h, p) => appendPoint(h, p), history) })),
}));

/** Ask main for the timeline so far (the popover opening). */
export async function loadHealthHistory(): Promise<void> {
  const history = await window.electronAPI.systemHealthHistory();
  useSystemHealthStore.getState().setHistory(history);
}

/** The tasks "Sleep N idle tasks" would put to sleep right now. */
export function idleTasksNow(): string[] {
  return idleTaskIds(useRuntime.getState().taskActivity, useProjects.getState().activeTaskId);
}

/** Put every idle task to sleep, through the task's own "Put to sleep"; the
 *  memory warning's and the health popover's action. Returns how many. */
export function sleepIdleTasks(): number {
  const ids = idleTasksNow();
  for (const id of ids) void useProjects.getState().closeTask(id);
  return ids.length;
}
